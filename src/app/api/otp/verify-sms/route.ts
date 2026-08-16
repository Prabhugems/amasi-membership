// @auth: public — verifies an SMS OTP for the apply flow; runs before the
// applicant has any session. Rate-limited per IP.
import { NextRequest } from "next/server"
import { otpMatches, OTP_FAILURE_MESSAGE } from "@/lib/otp-hash"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 10 verify attempts per 15 minutes per IP
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`otp-sms-verify:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many attempts. Please try again later." }, { status: 429 })
    }

    const { mobile, code } = await request.json()

    if (!mobile || !code) {
      return Response.json({ status: false, message: "Mobile and code are required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Find latest unexpired, unverified OTP for this mobile
    const { data: otpRecord, error } = await supabase
      .from("otp_codes")
      .select("id, code_hash, attempts, email")
      .eq("email", `sms:${mobile}`)
      .eq("verified", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (error || !otpRecord) {
      return Response.json({ status: false, message: OTP_FAILURE_MESSAGE }, { status: 400 })
    }

    if (otpRecord.attempts >= 5) {
      return Response.json({ status: false, message: OTP_FAILURE_MESSAGE }, { status: 400 })
    }

    // Increment attempts
    const { error: smsAttemptsErr } = await supabase.from("otp_codes").update({ attempts: otpRecord.attempts + 1 }).eq("id", otpRecord.id)
    if (smsAttemptsErr) {
      const Sentry = await import("@sentry/nextjs")
      Sentry.captureException(smsAttemptsErr, {
        tags: { component: "otp-verify-sms", op: "otp-attempts-increment" },
        extra: { otpId: otpRecord.id, mobile },
      })
    }

    // Compare against the stored hash. The code itself is never read back.
    if (!otpMatches(code, otpRecord.code_hash)) {
      return Response.json({ status: false, message: OTP_FAILURE_MESSAGE }, { status: 400 })
    }

    // Mark verified
    const { error: smsVerifiedErr } = await supabase.from("otp_codes").update({ verified: true }).eq("id", otpRecord.id)
    if (smsVerifiedErr) {
      const Sentry = await import("@sentry/nextjs")
      Sentry.captureException(smsVerifiedErr, {
        tags: { component: "otp-verify-sms", op: "otp-verified-flag" },
        extra: { otpId: otpRecord.id, mobile },
      })
    }

    return Response.json({ status: true, message: "Mobile verified successfully" })
  } catch (error: any) {
    console.error("SMS verify error:", error)
    return Response.json({ status: false, message: "Verification failed" }, { status: 500 })
  }
}

import { NextRequest } from "next/server"
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
      .select("*")
      .eq("email", `sms:${mobile}`)
      .eq("verified", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (error || !otpRecord) {
      return Response.json({ status: false, message: "No valid OTP found. Please request a new one." }, { status: 400 })
    }

    if (otpRecord.attempts >= 5) {
      return Response.json({ status: false, message: "Too many incorrect attempts. Please request a new OTP." }, { status: 429 })
    }

    // Increment attempts
    await supabase.from("otp_codes").update({ attempts: otpRecord.attempts + 1 }).eq("id", otpRecord.id)

    if (otpRecord.code !== code.trim()) {
      const remaining = 4 - (otpRecord.attempts + 1)
      return Response.json({ status: false, message: `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.` }, { status: 400 })
    }

    // Mark verified
    await supabase.from("otp_codes").update({ verified: true }).eq("id", otpRecord.id)

    return Response.json({ status: true, message: "Mobile verified successfully" })
  } catch (error: any) {
    console.error("SMS verify error:", error)
    return Response.json({ status: false, message: "Verification failed" }, { status: 500 })
  }
}

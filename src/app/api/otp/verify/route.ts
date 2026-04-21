import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { signToken, setMemberCookie } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 10 verify attempts per 15 minutes per IP
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`otp-verify:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many attempts. Please try again later." }, { status: 429 })
    }

    const { email, code } = await request.json()

    if (!email || !code) {
      return Response.json({ status: false, message: "Email and code are required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Find the latest unexpired, unverified OTP for this email
    const { data: otpRecord, error } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("email", email.toLowerCase())
      .eq("verified", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (error || !otpRecord) {
      return Response.json({ status: false, message: "No valid OTP found. Please request a new one." }, { status: 400 })
    }

    // Check max attempts (5)
    if (otpRecord.attempts >= 5) {
      return Response.json({ status: false, message: "Too many incorrect attempts. Please request a new OTP." }, { status: 429 })
    }

    // Increment attempts
    await supabase
      .from("otp_codes")
      .update({ attempts: otpRecord.attempts + 1 })
      .eq("id", otpRecord.id)

    // Verify code
    if (otpRecord.code !== code.trim()) {
      const remaining = 5 - (otpRecord.attempts + 1)
      return Response.json({
        status: false,
        message: `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`,
      }, { status: 400 })
    }

    // Mark as verified
    await supabase
      .from("otp_codes")
      .update({ verified: true })
      .eq("id", otpRecord.id)

    // Create member JWT session cookie
    const token = await signToken({
      sub: otpRecord.id,
      email: otpRecord.email,
      role: "member",
    }, "1h")
    await setMemberCookie(token)

    // Check for existing draft application
    let draft = null
    try {
      const { data: draftRow } = await supabase
        .from("draft_applications")
        .select("*")
        .eq("email", email.toLowerCase())
        .not("status", "in", '("completed","expired","refunded")')
        .limit(1)
        .maybeSingle()
      if (draftRow) {
        // Only return metadata — step_data contains PII and is fetched
        // separately via GET /api/applications/save-draft after user clicks Resume
        draft = {
          id: draftRow.id,
          current_step: draftRow.current_step,
          membership_type: draftRow.membership_type,
          status: draftRow.status,
          has_verified_payment: draftRow.has_verified_payment,
          created_at: draftRow.created_at,
          updated_at: draftRow.updated_at,
        }
      }
    } catch {
      // Draft check failure is non-blocking
    }

    return Response.json({
      status: true,
      message: "Email verified successfully",
      hasDraft: !!draft,
      draft,
    })
  } catch (error: any) {
    console.error("OTP verify error:", error)
    return Response.json({ status: false, message: "Verification failed" }, { status: 500 })
  }
}

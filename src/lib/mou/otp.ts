import { randomInt } from "node:crypto"
import { Resend } from "resend"
import { createAdminClient } from "@/lib/supabase"
import { hashOtp, otpMatches, OTP_FAILURE_MESSAGE } from "@/lib/otp-hash"
import { checkRateLimit } from "@/lib/rate-limit"
import { isValidEmailShape } from "@/lib/email-typo"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

function generateOtp(): string {
  return String(randomInt(100000, 999999))
}

type OtpResult = { ok: true } | { ok: false; message: string }

export async function sendMouOtp(email: string): Promise<OtpResult> {
  if (!email || !isValidEmailShape(email)) {
    return { ok: false, message: "Valid email is required" }
  }

  const rl = await checkRateLimit(`mou-otp:${email.toLowerCase()}`, 5, 15 * 60 * 1000)
  if (!rl.allowed) {
    return { ok: false, message: "Too many attempts. Please try again later." }
  }

  const code = generateOtp()
  const supabase = createAdminClient()
  const { error } = await supabase.from("otp_codes").insert({
    email: email.toLowerCase(),
    code_hash: hashOtp(code),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    verified: false,
    attempts: 0,
  })
  if (error) return { ok: false, message: "Could not send code. Please try again." }

  await getResend().emails.send({
    from: "AMASI <noreply@amasi.org>",
    to: email,
    subject: "Your AMASI application verification code",
    html: `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
  })

  return { ok: true }
}

export async function verifyMouOtp(email: string, code: string): Promise<OtpResult> {
  const supabase = createAdminClient()
  const { data: otpRecord, error } = await supabase
    .from("otp_codes")
    .select("id, code_hash, attempts, email")
    .eq("email", email.toLowerCase())
    .eq("verified", false)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

  if (error || !otpRecord) return { ok: false, message: OTP_FAILURE_MESSAGE }
  if (otpRecord.attempts >= 5) return { ok: false, message: OTP_FAILURE_MESSAGE }

  await supabase.from("otp_codes").update({ attempts: otpRecord.attempts + 1 }).eq("id", otpRecord.id)

  if (!otpMatches(code, otpRecord.code_hash)) return { ok: false, message: OTP_FAILURE_MESSAGE }

  await supabase.from("otp_codes").update({ verified: true }).eq("id", otpRecord.id)
  return { ok: true }
}

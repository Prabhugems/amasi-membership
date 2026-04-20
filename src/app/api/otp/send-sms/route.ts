import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { randomInt } from "node:crypto"

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY
const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID

function generateOTP(): string {
  return String(randomInt(100000, 999999))
}

export async function POST(request: NextRequest) {
  try {
    if (!MSG91_AUTH_KEY || !MSG91_TEMPLATE_ID) {
      return Response.json({ status: false, message: "SMS service not configured" }, { status: 500 })
    }

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`otp:${ip}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) return Response.json({ error: "Too many attempts" }, { status: 429 })

    const { mobile, email } = await request.json()

    if (!mobile || !/^\d{10}$/.test(mobile)) {
      return Response.json({ status: false, message: "Valid 10-digit mobile number required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Rate limit
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from("otp_codes")
      .select("*", { count: "exact", head: true })
      .eq("email", `sms:${mobile}`)
      .gte("created_at", tenMinAgo)

    if ((count || 0) >= 3) {
      return Response.json({ status: false, message: "Too many OTP requests. Please wait 10 minutes." }, { status: 429 })
    }

    const code = generateOTP()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    // Store OTP in DB
    const { error: insertError } = await supabase.from("otp_codes").insert({
      email: `sms:${mobile}`,
      code,
      expires_at: expiresAt.toISOString(),
    })

    if (insertError) {
      console.error("OTP insert error:", insertError)
      return Response.json({ status: false, message: "Failed to generate OTP. Please try again." }, { status: 500 })
    }

    // Try MSG91 SMS first
    try {
      const smsRes = await fetch(`https://control.msg91.com/api/v5/otp?template_id=${MSG91_TEMPLATE_ID}&mobile=91${mobile}&authkey=${MSG91_AUTH_KEY}&otp=${code}&otp_length=6&otp_expiry=10`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      const smsResult = await smsRes.json()

      if (smsResult.type === "success") {
        return Response.json({ status: true, message: "OTP sent to your mobile via SMS" })
      }
      console.error("MSG91 SMS error:", smsResult)
    } catch (smsErr) {
      console.error("MSG91 error:", smsErr)
    }

    // Fallback: send via email if SMS fails
    if (email) {
      try {
        const { Resend } = await import("resend")
        const resend = new Resend(process.env.RESEND_API_KEY?.trim())
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
          to: email,
          subject: `${code} — AMASI Mobile Verification`,
          html: `<div style="font-family:Arial;max-width:480px;margin:0 auto;padding:24px"><h2>Verify Your Mobile</h2><p>Code to verify +91 ${mobile}:</p><div style="background:#f4f4f5;border-radius:8px;padding:20px;text-align:center;margin:20px 0"><span style="font-size:32px;font-weight:bold;letter-spacing:6px">${code}</span></div><p style="font-size:14px;color:#555">Expires in 10 minutes.</p></div>`,
        })
        return Response.json({ status: true, message: "OTP sent to your email (SMS delivery pending)" })
      } catch {}
    }

    return Response.json({ status: false, message: "Failed to send OTP" }, { status: 500 })
  } catch (error: any) {
    console.error("OTP send error:", error)
    return Response.json({ status: false, message: "Failed to send OTP" }, { status: 500 })
  }
}

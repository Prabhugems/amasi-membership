import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { Resend } from "resend"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { randomInt } from "node:crypto"

function generateOTP(): string {
  return String(randomInt(100000, 999999))
}

// Uniform response for any valid identifier — does NOT confirm whether the
// reference number or email was found in the database (oracle prevention).
function oracleSafeResponse() {
  return Response.json(
    { ok: true, message: "If the reference number is valid, an OTP has been sent." },
    { status: 200 }
  )
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`track-otp:${ip}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ ok: false, message: "Too many requests. Please try again later." }, { status: 429 })
    }

    const body = await request.json()
    const { email: emailInput, referenceNumber } = body

    const supabase = createAdminClient()
    let resolvedEmail: string | null = null
    let resolvedRefNumber: string | null = null

    if (referenceNumber?.trim()) {
      const ref = referenceNumber.trim().toUpperCase()
      const { data: app } = await supabase
        .from("membership_applications")
        .select("email")
        .eq("reference_number", ref)
        .maybeSingle()

      // Do NOT reveal whether the reference number was found.
      // Same response for found and not-found to prevent email enumeration oracle.
      if (!app) {
        return oracleSafeResponse()
      }
      resolvedEmail = app.email.toLowerCase().trim()
      resolvedRefNumber = ref
    } else if (emailInput?.includes("@")) {
      resolvedEmail = emailInput.toLowerCase().trim()
      const { data: app } = await supabase
        .from("membership_applications")
        .select("id")
        .eq("email", resolvedEmail)
        .maybeSingle()

      // Same oracle-safe pattern: don't confirm whether the email exists.
      if (!app) {
        return oracleSafeResponse()
      }
    } else {
      return Response.json(
        { ok: false, message: "Please provide a valid email or reference number." },
        { status: 400 }
      )
    }

    // Rate limit: max 3 OTPs per email per 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from("otp_codes")
      .select("*", { count: "exact", head: true })
      .eq("email", resolvedEmail)
      .gte("created_at", tenMinAgo)

    if ((count || 0) >= 3) {
      return Response.json(
        { ok: false, message: "Too many OTP requests. Please wait 10 minutes." },
        { status: 429 }
      )
    }

    const code = generateOTP()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    const { error: insertError } = await supabase.from("otp_codes").insert({
      email: resolvedEmail,
      code,
      expires_at: expiresAt.toISOString(),
      reference_number: resolvedRefNumber,
    })

    if (insertError) {
      console.error("[track/send-otp] insert error:", insertError)
      return Response.json({ ok: false, message: "Failed to generate OTP." }, { status: 500 })
    }

    const resendKey = process.env.RESEND_API_KEY?.trim()
    if (!resendKey) {
      console.error("[track/send-otp] RESEND_API_KEY not set")
      return Response.json({ ok: false, message: "Email service not configured." }, { status: 500 })
    }

    const resend = new Resend(resendKey)
    const { error: emailError } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
      to: resolvedEmail as string,
      subject: "Track your AMASI application — verification code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a1a; margin-bottom: 16px;">Track Your Application</h2>
          <p style="color: #555; font-size: 15px;">Enter this code to view your AMASI membership application status:</p>
          <div style="background: #f4f4f5; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1a1a1a;">${code}</span>
          </div>
          <p style="color: #555; font-size: 14px;">This code expires in 10 minutes. Do not share it with anyone.</p>
          <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px;">Association of Minimal Access Surgeons of India</p>
        </div>
      `,
    })

    if (emailError) {
      console.error("[track/send-otp] email send error:", emailError)
      return Response.json({ ok: false, message: "Failed to send verification email." }, { status: 500 })
    }

    return oracleSafeResponse()
  } catch (error: unknown) {
    console.error("[track/send-otp] unexpected error:", error)
    Sentry.captureException(error)
    return Response.json({ ok: false, message: "Something went wrong. Please try again." }, { status: 500 })
  }
}

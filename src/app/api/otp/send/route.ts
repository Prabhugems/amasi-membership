import { NextRequest } from "next/server"
import { Resend } from "resend"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { randomInt } from "node:crypto"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

function generateOTP(): string {
  return String(randomInt(100000, 999999))
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`otp:${ip}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) return Response.json({ error: "Too many attempts" }, { status: 429 })

    const { email, phone, membershipType } = await request.json()

    if (!email || !email.includes("@")) {
      return Response.json({ status: false, message: "Valid email is required" }, { status: 400 })
    }

    // Skip OTP for placeholder emails
    if (email.includes("@placeholder.amasi.org")) {
      return Response.json({ status: false, message: "Cannot send OTP to placeholder email. Please contact admin." }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Zombie-draft guard: if the caller did not pass a membership_type,
    // require that the email already has a draft with a type OR a submitted
    // membership_applications row (profile OTP / resubmit flows are legitimate
    // null-type callers). Otherwise the /apply flow slipped past type
    // selection and we would create a draft with membership_type: null that
    // never progresses.
    if (!membershipType) {
      const emailKey = email.toLowerCase()
      const [{ data: typedDraft }, { data: submittedApp }, { data: existingMember }] = await Promise.all([
        supabase
          .from("draft_applications")
          .select("id")
          .eq("email", emailKey)
          .not("membership_type", "is", null)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("membership_applications")
          .select("id")
          .eq("email", emailKey)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("members")
          .select("id")
          .ilike("email", emailKey)
          .limit(1)
          .maybeSingle(),
      ])

      if (!typedDraft && !submittedApp && !existingMember) {
        return Response.json(
          {
            status: false,
            code: "MEMBERSHIP_TYPE_REQUIRED",
            message: "Please select a membership type before verifying your email.",
          },
          { status: 400 }
        )
      }
    }

    // Rate limit: max 3 OTPs per email per 10 minutes
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { count } = await supabase
      .from("otp_codes")
      .select("*", { count: "exact", head: true })
      .eq("email", email.toLowerCase())
      .gte("created_at", tenMinAgo)

    if ((count || 0) >= 3) {
      return Response.json({ status: false, message: "Too many OTP requests. Please wait 10 minutes." }, { status: 429 })
    }

    const code = generateOTP()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 min expiry

    // Store OTP
    const { error: insertError } = await supabase.from("otp_codes").insert({
      email: email.toLowerCase(),
      code,
      expires_at: expiresAt.toISOString(),
    })

    if (insertError) {
      console.error("OTP insert error:", insertError)
      return Response.json({ status: false, message: "Failed to generate OTP" }, { status: 500 })
    }

    // Send email
    const resend = getResend()
    const { error: emailError } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
      to: email,
      subject: "Your AMASI Verification Code",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a1a; margin-bottom: 16px;">AMASI Profile Verification</h2>
          <p style="color: #555; font-size: 15px;">Your verification code is:</p>
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
      console.error("Email send error:", emailError)
      return Response.json({ status: false, message: "Failed to send email. Please try again." }, { status: 500 })
    }

    // Create or update draft application on OTP send — earliest capture point.
    // Gated on membershipType: only application-flow callers (apply page) declare
    // a type. Login/profile/ticket flows omit it and must NOT touch drafts —
    // the existingMember exception added by 24547fc (legacy-member login) had
    // been silently spawning null-type zombie drafts every time a member used
    // OTP for any non-application purpose.
    if (membershipType) {
      try {
        const { data: existingDraft } = await supabase
          .from("draft_applications")
          .select("id, membership_type")
          .eq("email", email.toLowerCase())
          .maybeSingle()

        if (!existingDraft) {
          await supabase.from("draft_applications").insert({
            email: email.toLowerCase(),
            phone: phone || null,
            membership_type: membershipType || null,
            current_step: 2,
            status: "in_progress",
            step_data: { otp_sent: true, otp_sent_at: new Date().toISOString() },
          })
        } else {
          // Backfill membership_type if the draft is a null-type zombie from
          // the old bypass bug and the caller now provides a type. Without this,
          // victims returning through the reminder email would complete the
          // entire flow with a null membership_type on their draft.
          const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
          if (membershipType && !existingDraft.membership_type) {
            update.membership_type = membershipType.toUpperCase()
          }
          await supabase.from("draft_applications")
            .update(update)
            .eq("id", existingDraft.id)
        }
      } catch {
        // Draft creation failure is non-blocking — OTP still sent
      }
    }

    return Response.json({ status: true, message: "OTP sent to your email" })
  } catch (error: unknown) {
    console.error("OTP send error:", error)
    return Response.json({ status: false, message: "Failed to send OTP" }, { status: 500 })
  }
}

// @auth: public — legacy mobile shim. Login-flow resend OTP. Flutter posts
// `id` (memberId from the prior send) + `email`. We re-mint a fresh 6-digit
// code, persist it, and email it via Resend — same flow as
// /common_member_send_otp but starting from a known-good member-id+email pair.
//
// See migration/SHIM_README.md and migration/flutter-usage.md row 6.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import {
  legacyOk,
  legacyErr,
  parseLegacyForm,
  field,
  generateShimOtp,
  sendShimOtpEmail,
} from "@/lib/mobile-shim"

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    // Slightly tighter than send (which also covers first-time resolution)
    // — resend should never be more than a few clicks per session.
    const rl = await checkRateLimit(`shim-login-resend:${ip}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many attempts. Please try again later.")
    }

    const form = await parseLegacyForm(request)
    const memberId = field(form, "id").trim()
    const email = field(form, "email").toLowerCase().trim()

    if (!memberId || !email) {
      return legacyErr("Id and email are required")
    }

    const supabase = createAdminClient()

    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id, email")
      .eq("id", memberId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle()

    if (memberErr) {
      Sentry.captureException(memberErr, {
        tags: { route: "shim/common_member_resend_otp", phase: "member-lookup" },
      })
      return legacyErr("Something went wrong")
    }

    if (!member) {
      return legacyErr("Member not found")
    }

    const code = generateShimOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    const { error: insertError } = await supabase.from("otp_codes").insert({
      email,
      code,
      expires_at: expiresAt.toISOString(),
    })
    if (insertError) {
      Sentry.captureException(insertError, {
        tags: { route: "shim/common_member_resend_otp", op: "otp_insert" },
      })
      return legacyErr("Failed to generate OTP")
    }

    try {
      await sendShimOtpEmail(email, code)
    } catch (sendErr) {
      Sentry.captureException(sendErr, {
        tags: { route: "shim/common_member_resend_otp", op: "email_send" },
      })
      // Don't fail the response — the OTP row is in the DB; the user can
      // request another resend if the email doesn't arrive.
    }

    return legacyOk("OTP resent successfully")
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/common_member_resend_otp" } })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST

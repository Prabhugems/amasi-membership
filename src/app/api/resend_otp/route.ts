// @auth: public — legacy mobile shim. Apply-flow OTP resend. Looks up the
// draft by `id`, mints a new OTP, sends via Resend. See backend-spec.md §23.

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
    const rl = await checkRateLimit(`shim-resend-otp:${ip}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many attempts. Please try again later.")
    }

    const form = await parseLegacyForm(request)
    const draftId = field(form, "id").trim()
    if (!draftId) return legacyErr("Member not found")

    const supabase = createAdminClient()

    const { data: draft } = await supabase
      .from("draft_applications")
      .select("id, email")
      .eq("id", draftId)
      .maybeSingle()

    if (!draft) return legacyErr("Member not found")

    const email = (draft.email as string).toLowerCase()
    const code = generateShimOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)

    const { error: otpErr } = await supabase.from("otp_codes").insert({
      email,
      code,
      expires_at: expiresAt.toISOString(),
    })
    if (otpErr) {
      Sentry.captureException(otpErr, {
        tags: { route: "shim/resend_otp", op: "otp_insert" },
      })
      return legacyErr("Failed to generate OTP")
    }

    try {
      await sendShimOtpEmail(email, code)
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: "shim/resend_otp", op: "email_send" },
      })
      return legacyErr("Failed to send email. Please try again.")
    }

    return legacyOk("OTP send your mail", {
      data: { id: draft.id },
      userid: draft.id,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/resend_otp" } })
    return legacyErr("Something went wrong")
  }
}

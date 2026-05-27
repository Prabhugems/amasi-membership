// @auth: public — legacy mobile shim. Apply-flow OTP verify. Looks up the
// draft by `id` (= userid returned from /send_otp), verifies the OTP, marks
// the draft's step_data.email_verified=true, advances current_step.
//
// Legacy quirk preserved: invalid OTP returns HTTP 201 (not 400). The Dio
// client treats 201 as success; Flutter parses status:false to show the
// error. See migration/backend-spec.md §22 "Notes / gotchas."
//
// `application_no` is null at this step — amasi-membership assigns the AMASI
// number at approval via the `next_amasi_number` Postgres sequence, not at
// OTP verify. Flutter doesn't render application_no until the receipt
// screen (which comes after /application_data).

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { legacyOk, legacyErr, parseLegacyForm, field, fieldOrNull } from "@/lib/mobile-shim"

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`shim-otp-verify:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many attempts. Please try again later.")
    }

    const form = await parseLegacyForm(request)
    const draftId = field(form, "id").trim()
    const code = field(form, "otp").trim()
    const applicationIdEcho = fieldOrNull(form, "application_id")

    if (!draftId || !code) {
      return legacyErr("Member not found")
    }

    const supabase = createAdminClient()

    const { data: draft } = await supabase
      .from("draft_applications")
      .select("id, email, step_data")
      .eq("id", draftId)
      .maybeSingle()

    if (!draft) {
      return legacyErr("Member not found")
    }

    const emailLower = (draft.email as string).toLowerCase()

    const { data: otpRecord } = await supabase
      .from("otp_codes")
      .select("id, code, attempts")
      .eq("email", emailLower)
      .eq("verified", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!otpRecord) {
      return legacyErr("OTP has expired")
    }
    if (otpRecord.attempts >= 5) {
      return legacyErr("Too many incorrect attempts. Please request a new OTP.")
    }

    await supabase
      .from("otp_codes")
      .update({ attempts: (otpRecord.attempts ?? 0) + 1 })
      .eq("id", otpRecord.id)

    if (otpRecord.code !== code) {
      return new Response(
        JSON.stringify({ status: false, message: "Invalid OTP" }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    }

    await supabase
      .from("otp_codes")
      .update({ verified: true })
      .eq("id", otpRecord.id)

    const mergedStepData = {
      ...((draft.step_data as Record<string, unknown>) || {}),
      email_verified: true,
      email_verified_at: new Date().toISOString(),
    }
    await supabase
      .from("draft_applications")
      .update({
        step_data: mergedStepData,
        current_step: 2,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id)

    return legacyOk("OTP Verified Successfully", {
      userid: draft.id,
      application_id: applicationIdEcho ?? null,
      application_no: null,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/otp_verify" } })
    return legacyErr("Something went wrong")
  }
}

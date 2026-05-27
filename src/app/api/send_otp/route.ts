// @auth: public — legacy mobile shim. Apply-flow OTP send. Creates or
// updates a draft_applications row for the applicant, mints a 6-digit OTP,
// and emails it via Resend. The Flutter v1.0.4+2 binary stores `userid`
// from the response (the draft.id UUID — opaque to Flutter) and posts it
// back as `id` to /otp_verify and /resend_otp.
//
// On the first call for a given email, the response includes
// `message1: "insert"` — Flutter inspects this to decide which UI branch
// to take. Do NOT drop this field.
//
// See migration/backend-spec.md §21.

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
import { findApplicationType } from "@/app/api/get_application/route"

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`shim-apply-otp:${ip}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many attempts. Please try again later.")
    }

    const form = await parseLegacyForm(request)
    const firstName = field(form, "first_name").trim()
    const lastName = field(form, "last_name").trim()
    const email = field(form, "email").toLowerCase().trim()
    const mobileCode = field(form, "mobile_code").trim()
    const mobile = field(form, "mobile").trim()
    const membershipNo = field(form, "membership_no").trim()
    const applicationIdRaw = field(form, "application_id").trim()

    if (!email || !email.includes("@")) {
      return legacyErr("Invalid email")
    }
    if (!firstName || !lastName) {
      return legacyErr("First and last name are required")
    }

    const appType = applicationIdRaw ? findApplicationType(applicationIdRaw) : null
    if (!appType) {
      return legacyErr("Invalid application_id")
    }

    const reqBodyEcho = {
      first_name: firstName,
      last_name: lastName,
      email,
      mobile_code: mobileCode,
      mobile,
      membership_no: membershipNo,
      application_id: applicationIdRaw,
    }

    const supabase = createAdminClient()

    const { data: existing } = await supabase
      .from("draft_applications")
      .select("id, step_data, has_verified_payment")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    let draftId: string
    let isNew = false

    if (existing) {
      if (existing.has_verified_payment) {
        // Paid draft — apply-flow OTP doesn't apply; the user should be
        // routed to the receipt/submission path. Return a soft error rather
        // than blocking; Flutter renders the message.
        return legacyErr("Your previous application is still being processed.")
      }
      draftId = existing.id
      const mergedStepData = {
        ...((existing.step_data as Record<string, unknown>) || {}),
        formData: {
          first_name: firstName,
          last_name: lastName,
          email,
          mobile_code: mobileCode,
          mobile,
          membership_no: membershipNo,
          application_id: applicationIdRaw,
          source: "mobile_v1_shim",
        },
        otp_sent: true,
        otp_sent_at: new Date().toISOString(),
      }
      const { error: updateError } = await supabase
        .from("draft_applications")
        .update({
          phone: mobile || null,
          membership_type: appType.typeKey,
          step_data: mergedStepData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
      if (updateError) {
        Sentry.captureException(updateError, {
          tags: { route: "shim/send_otp", op: "draft_update" },
        })
        return legacyErr("Failed to update draft")
      }
    } else {
      isNew = true
      const { data: inserted, error: insertError } = await supabase
        .from("draft_applications")
        .insert({
          email,
          phone: mobile || null,
          membership_type: appType.typeKey,
          current_step: 1,
          status: "in_progress",
          step_data: {
            formData: {
              first_name: firstName,
              last_name: lastName,
              email,
              mobile_code: mobileCode,
              mobile,
              membership_no: membershipNo,
              application_id: applicationIdRaw,
              source: "mobile_v1_shim",
            },
            otp_sent: true,
            otp_sent_at: new Date().toISOString(),
          },
        })
        .select("id")
        .single()
      if (insertError || !inserted) {
        Sentry.captureException(insertError, {
          tags: { route: "shim/send_otp", op: "draft_insert" },
        })
        return legacyErr("Failed to create application")
      }
      draftId = inserted.id
    }

    const code = generateShimOtp()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000)
    const { error: otpErr } = await supabase.from("otp_codes").insert({
      email,
      code,
      expires_at: expiresAt.toISOString(),
    })
    if (otpErr) {
      Sentry.captureException(otpErr, {
        tags: { route: "shim/send_otp", op: "otp_insert" },
      })
      return legacyErr("Failed to generate OTP")
    }

    try {
      await sendShimOtpEmail(email, code)
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: "shim/send_otp", op: "email_send" },
      })
      return legacyErr("Failed to send email. Please try again.")
    }

    return legacyOk("OTP send your mail", {
      data: reqBodyEcho,
      userid: draftId,
      ...(isNew ? { message1: "insert" } : {}),
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/send_otp" } })
    return legacyErr("Something went wrong")
  }
}

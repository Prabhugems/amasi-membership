// @auth: public — legacy mobile shim. Login-flow OTP send. Looks up an
// active AMASI member by email; if found, mints a 6-digit OTP and emails it
// via Resend. The Flutter v1.0.4+2 binary stores `userid` from the response
// and posts it back as `id` to /common_member_otp_verify.
//
// See migration/backend-spec.md §5.

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
    const rl = await checkRateLimit(`shim-login-otp:${ip}`, 15, 15 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many attempts. Please try again later.")
    }

    const form = await parseLegacyForm(request)
    const email = field(form, "email").toLowerCase().trim()
    if (!email || !email.includes("@")) {
      return legacyErr("Invalid email")
    }

    const supabase = createAdminClient()

    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id, email, amasi_number")
      .ilike("email", email)
      .limit(1)
      .maybeSingle()

    if (memberErr) {
      Sentry.captureException(memberErr, {
        tags: { route: "shim/common_member_send_otp", phase: "member-lookup" },
      })
      return legacyErr("Something went wrong")
    }

    if (!member) {
      return legacyErr("Account not found")
    }

    // Flutter binary's `MemberSendOtpModel.userid` is typed `int?` — sending
    // a UUID string here throws a TypeError in Dart, the catch shows a
    // "something went wrong" toast, and `loginController.memberId` stays
    // null, breaking the subsequent verify call. Return amasi_number (int)
    // so the parse succeeds. Approved members all have one; for the rare
    // pending-applicant edge case we return null and the upstream verify
    // route rejects on missing id.
    if (member.amasi_number == null) {
      return legacyErr(
        "Your membership number isn't assigned yet — please wait for approval."
      )
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
        tags: { route: "shim/common_member_send_otp", op: "otp_insert" },
      })
      return legacyErr("Failed to generate OTP")
    }

    try {
      await sendShimOtpEmail(email, code)
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: "shim/common_member_send_otp", op: "email_send" },
      })
      return legacyErr("Failed to send email. Please try again.")
    }

    // Legacy envelope: { status, message, data: <req.body>, userid }.
    // userid MUST be an int (Flutter's MemberSendOtpModel.userid is int?);
    // we return amasi_number which the verify route accepts as the
    // legacy-shape id.
    return legacyOk("OTP send your mail", {
      data: { email },
      userid: member.amasi_number,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/common_member_send_otp" } })
    return legacyErr("Something went wrong")
  }
}

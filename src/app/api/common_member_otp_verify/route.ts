// @auth: public — legacy mobile shim. Login-flow OTP verify. Validates the
// OTP, issues a member JWT, and returns the legacy envelope with member: 1
// (number, NOT boolean — per migration/MIGRATION_FINDINGS.md §6 the Flutter
// client switches on the numeric value).
//
// See migration/backend-spec.md §7.

import type { NextRequest } from "next/server"
import { otpMatches, OTP_FAILURE_MESSAGE } from "@/lib/otp-hash"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { signToken } from "@/lib/auth"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`shim-login-otp-verify:${ip}`, 30, 15 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many attempts. Please try again later.")
    }

    const form = await parseLegacyForm(request)
    const email = field(form, "email").toLowerCase().trim()
    const memberId = field(form, "id")
    const code = field(form, "otp").trim()

    if (!email || !memberId || !code) {
      return legacyErr("Email, id, and otp are required")
    }

    const supabase = createAdminClient()

    // Flutter's MemberSendOtpModel.userid is int?, so send_otp returns
    // amasi_number (int) and the binary echoes it back here as `id`. New
    // callers (curl, tests) still pass a member UUID. Branch on shape so
    // both work.
    const isAmasiNumber = /^\d+$/.test(memberId)
    const memberQuery = supabase
      .from("members")
      .select(
        "id, email, first_name, middle_name, last_name, salutation, phone, amasi_number, profile_photo"
      )
      .ilike("email", email)
      .limit(1)

    const { data: member, error: memberErr } = await (isAmasiNumber
      ? memberQuery.eq("amasi_number", parseInt(memberId, 10))
      : memberQuery.eq("id", memberId)
    ).maybeSingle()

    if (memberErr) {
      // Don't swallow the error — schema drift / missing column would otherwise
      // surface as the same "Member not found" message a true miss returns,
      // hiding the real bug. See CONTEXT.md "Schema drift via swallowed selects".
      Sentry.captureException(memberErr, {
        tags: { route: "shim/common_member_otp_verify", phase: "member-lookup" },
      })
      return legacyErr("Something went wrong")
    }

    if (!member) {
      return legacyErr("Member not found")
    }

    const { data: otpRecord } = await supabase
      .from("otp_codes")
      .select("id, code_hash, attempts, expires_at")
      .eq("email", email)
      .eq("verified", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!otpRecord) {
      return legacyErr(OTP_FAILURE_MESSAGE)
    }
    if (otpRecord.attempts >= 5) {
      return legacyErr(OTP_FAILURE_MESSAGE)
    }

    await supabase
      .from("otp_codes")
      .update({ attempts: (otpRecord.attempts ?? 0) + 1 })
      .eq("id", otpRecord.id)

    // Compare against the stored hash. The code itself is never read back.
    if (!otpMatches(code, otpRecord.code_hash)) {
      // Legacy returns HTTP 201 with status:false here — Dio treats 201 as
      // success and Flutter parses `status: false` to show the error.
      return new Response(
        JSON.stringify({ status: false, message: OTP_FAILURE_MESSAGE }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    }

    await supabase
      .from("otp_codes")
      .update({ verified: true })
      .eq("id", otpRecord.id)

    // Best-effort FCM token persistence — Flutter forwards `device_id`
    // (its misnomer for the FCM token) in the verify body. Upsert into
    // fcm_tokens with member_id so future admin pushes can reach this
    // member. Failure here must NOT block login.
    const fcmToken = field(form, "device_id").trim()
    if (fcmToken && fcmToken.length >= 20) {
      const { error: tokenErr } = await supabase
        .from("fcm_tokens")
        .upsert(
          {
            token: fcmToken,
            member_id: member.id,
            platform: "fcm",
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "token" }
        )
      if (tokenErr) {
        Sentry.captureException(tokenErr, {
          tags: { route: "shim/common_member_otp_verify", op: "fcm-upsert" },
        })
      }
    } else {
      // Reconciliation fallback: Flutter's `FirebaseMessaging.instance.getToken()`
      // is async at app boot. If the user logs in faster than the token
      // resolves, `loginController.deviceId` is empty and `device_id` is
      // missing from the verify body — but `/api/device_token_update` would
      // have already persisted the token anonymously moments earlier from
      // the same app.
      //
      // If we see EXACTLY ONE anonymous fcm_tokens row created in the last
      // 60s, bind it to this member. Bail on 0 or >1 matches (the latter
      // would be a race-condition risk — two members logging in within the
      // same 60s window — and a wrong bind would leak push notifications).
      const sixtySecondsAgo = new Date(Date.now() - 60 * 1000).toISOString()
      const { data: candidates } = await supabase
        .from("fcm_tokens")
        .select("id")
        .is("member_id", null)
        .gte("created_at", sixtySecondsAgo)
        .order("created_at", { ascending: false })
        .limit(2)
      if (candidates && candidates.length === 1) {
        const { error: bindErr } = await supabase
          .from("fcm_tokens")
          .update({
            member_id: member.id,
            updated_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          })
          .eq("id", candidates[0].id)
          .is("member_id", null) // CAS guard — don't clobber a binding that
                                  // landed concurrently
        if (bindErr) {
          Sentry.captureException(bindErr, {
            tags: { route: "shim/common_member_otp_verify", op: "fcm-reconcile" },
          })
        }
      }
    }

    const accessToken = await signToken(
      {
        sub: member.id,
        email: member.email,
        role: "member",
      },
      "90d"
    )

    // Legacy data shape: array containing one tbl_member-ish row. Flutter
    // reads data[0].{id, application_id, membership_no, first_name, email,
    // profile, application_status} per migration/flutter-usage.md row 4.
    const memberRow = {
      id: member.id,
      application_id: null,
      membership_no: member.amasi_number ?? null,
      first_name: member.first_name ?? "",
      middle_name: member.middle_name ?? "",
      last_name: member.last_name ?? "",
      salutation: member.salutation ?? "",
      email: member.email,
      // members.phone is bigint — coerce at boundary; legacy Flutter expects string.
      mobile: member.phone != null ? String(member.phone) : "",
      profile: member.profile_photo ?? "",
      application_status: 12, // legacy: approved-final
    }

    return legacyOk("OTP Verified Successfully", {
      access_token: accessToken,
      refresh_token: "",
      member: 1, // number, NOT boolean
      userid: member.id,
      data: [memberRow],
      event: 0,
      event_data: [],
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/common_member_otp_verify" } })
    return legacyErr("Something went wrong")
  }
}

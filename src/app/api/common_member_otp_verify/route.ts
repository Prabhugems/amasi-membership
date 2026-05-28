// @auth: public — legacy mobile shim. Login-flow OTP verify. Validates the
// OTP, issues a member JWT, and returns the legacy envelope with member: 1
// (number, NOT boolean — per migration/MIGRATION_FINDINGS.md §6 the Flutter
// client switches on the numeric value).
//
// See migration/backend-spec.md §7.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { signToken } from "@/lib/auth"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`shim-login-otp-verify:${ip}`, 10, 15 * 60 * 1000)
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

    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select(
        "id, email, first_name, middle_name, last_name, salutation, phone, amasi_number, profile_photo"
      )
      .eq("id", memberId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle()

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
      .select("id, code, attempts, expires_at")
      .eq("email", email)
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
      // Legacy returns HTTP 201 with status:false here — Dio treats 201 as
      // success and Flutter parses `status: false` to show the error.
      return new Response(
        JSON.stringify({ status: false, message: "Invalid OTP" }),
        { status: 201, headers: { "content-type": "application/json" } }
      )
    }

    await supabase
      .from("otp_codes")
      .update({ verified: true })
      .eq("id", otpRecord.id)

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

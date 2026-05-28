// @auth: public — legacy mobile shim. The Flutter "Find Membership Number"
// screen (lib/view/application/know_application_track.dart:154) posts
// `email` and/or `mobile` and expects the legacy envelope with
// `data[0].id` (the only field Flutter actually captures and passes to the
// next screen, which then calls /api/member_info with that id).
//
// We search membership_applications first (the legacy lookup target) and
// fall back to `members` if no application matches — covers the case where
// a member exists but their application record is in another table.
//
// See migration/SHIM_README.md and migration/flutter-usage.md row 13.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const email = field(form, "email").toLowerCase().trim()
    const mobile = field(form, "mobile").trim()

    if (!email && !mobile) {
      return legacyErr("Email or mobile is required")
    }

    const supabase = createAdminClient()

    // Build a query that matches either email or phone (whichever the caller
    // supplied) on the membership_applications table.
    let appQuery = supabase
      .from("membership_applications")
      .select(
        "id, reference_number, email, phone, status, assigned_amasi_number, member_id, first_name, last_name, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(1)

    if (email && mobile) {
      // Both supplied — match either to be permissive (legacy behavior).
      appQuery = appQuery.or(`email.ilike.${email},phone.eq.${mobile}`)
    } else if (email) {
      appQuery = appQuery.ilike("email", email)
    } else {
      appQuery = appQuery.eq("phone", mobile)
    }

    const { data: app, error: appErr } = await appQuery.maybeSingle()

    if (appErr) {
      Sentry.captureException(appErr, {
        tags: { route: "shim/know_membership", phase: "applications-lookup" },
      })
      return legacyErr("Something went wrong")
    }

    if (app) {
      // Legacy captures only `id` from data[0]; include extra fields for
      // any downstream caller that wants them, but Flutter ignores them.
      return legacyOk("OK", {
        data: [
          {
            id: app.id,
            application_no: app.reference_number ?? null,
            membership_no: app.assigned_amasi_number ?? null,
            first_name: app.first_name ?? "",
            last_name: app.last_name ?? "",
            email: app.email ?? "",
          },
        ],
      })
    }

    // Fallback: maybe the user is a member with no surviving application row.
    // members.phone is bigint — compare via cast.
    let memberQuery = supabase
      .from("members")
      .select("id, email, phone, amasi_number, first_name, last_name")
      .limit(1)

    if (email) {
      memberQuery = memberQuery.ilike("email", email)
    } else {
      // phone is bigint — parse before comparison.
      const phoneNum = parseInt(mobile, 10)
      if (Number.isNaN(phoneNum)) {
        return legacyErr("Invalid mobile number")
      }
      memberQuery = memberQuery.eq("phone", phoneNum)
    }

    const { data: member, error: memberErr } = await memberQuery.maybeSingle()

    if (memberErr) {
      Sentry.captureException(memberErr, {
        tags: { route: "shim/know_membership", phase: "members-fallback" },
      })
      return legacyErr("Something went wrong")
    }

    if (!member) {
      return legacyErr("No membership record found for the given email/mobile")
    }

    return legacyOk("OK", {
      data: [
        {
          id: member.id,
          membership_no: member.amasi_number ?? null,
          first_name: member.first_name ?? "",
          last_name: member.last_name ?? "",
          email: member.email ?? "",
        },
      ],
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/know_membership" } })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST

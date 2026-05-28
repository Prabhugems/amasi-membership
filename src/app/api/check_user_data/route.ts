// @auth: public — legacy mobile shim. The Flutter events webview WillPop
// hook (lib/view/events/events_webview.dart:235) posts `username` (= the
// stored member email) and expects `{status, member, event}` flags to
// decide whether the cached session is still valid for the event tab.
//
// Event integration isn't wired into amasi-membership yet, so `event` is
// always 0. `member: 1` when an active member exists for that email; else 0.
//
// See migration/SHIM_README.md and migration/flutter-usage.md row 3.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const username = field(form, "username").toLowerCase().trim()

    if (!username) {
      return legacyErr("Username is required")
    }

    const supabase = createAdminClient()
    const { data: member, error } = await supabase
      .from("members")
      .select("id, status")
      .ilike("email", username)
      .limit(1)
      .maybeSingle()

    if (error) {
      // Don't swallow — surface schema drift / column errors via Sentry
      // rather than silently looking like "no member found". See
      // CONTEXT.md "schema drift via swallowed selects".
      Sentry.captureException(error, {
        tags: { route: "shim/check_user_data", phase: "member-lookup" },
      })
      return legacyErr("Something went wrong")
    }

    return legacyOk("OK", {
      member: member && member.status === "active" ? 1 : 0,
      event: 0,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/check_user_data" } })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST

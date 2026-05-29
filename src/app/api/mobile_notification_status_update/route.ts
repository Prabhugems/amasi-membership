// @auth: public — legacy mobile shim. Tap-to-read on a single notification.
// Flutter posts `id` (the row id of the notification — uuid in our new
// schema). We set `read_at = now()` if it's null; idempotent if already read.
//
// See sql/036_member_notifications.sql.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const id = field(form, "id").trim()
    if (!id) return legacyErr("id is required")

    const supabase = createAdminClient()
    const { error } = await supabase
      .from("member_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null)

    if (error) {
      Sentry.captureException(error, {
        tags: { route: "shim/mobile_notification_status_update" },
      })
      return legacyErr("Something went wrong")
    }

    return legacyOk("OK")
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "shim/mobile_notification_status_update" },
    })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST

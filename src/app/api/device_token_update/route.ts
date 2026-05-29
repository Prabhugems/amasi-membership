// @auth: public — legacy mobile shim. Flutter posts `{device_id: <FCM token>}`
// on every app boot (lib/main.dart:678) and fire-and-forgets the response.
//
// At boot there's no auth context, so we upsert the token with member_id
// = null. The same token gets bound to a member when it arrives in a
// /common_member_otp_verify call later (which knows the member). Stale
// anonymous rows can be reaped by a cleanup job on `last_seen_at`.
//
// See migration/SHIM_README.md, sql/035_fcm_tokens.sql.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { legacyOk, parseLegacyForm, field } from "@/lib/mobile-shim"

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const token = field(form, "device_id").trim()

    if (token && token.length >= 20) {
      const supabase = createAdminClient()
      const { error } = await supabase
        .from("fcm_tokens")
        .upsert(
          {
            token,
            platform: "fcm",
            last_seen_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "token", ignoreDuplicates: false }
        )
      if (error) {
        Sentry.captureException(error, {
          tags: { route: "shim/device_token_update", op: "fcm-upsert" },
        })
      }
    }

    // Legacy contract — return success even when no token; the Flutter
    // client doesn't read this response.
    return legacyOk("OK")
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/device_token_update" } })
    return legacyOk("OK")
  }
}

export const GET = POST

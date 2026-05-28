// @auth: public — legacy mobile shim. Flutter posts `{device_id: <FCM token>}`
// on every app boot (lib/main.dart:678) and fire-and-forgets the response.
//
// We don't persist the token. The existing `device_tokens` table is for
// the Expo app and uses `expo_push_token`; cross-loading FCM tokens into
// that column would cause future Expo push sends to try delivering to FCM
// endpoints (which 400s and noisifies Sentry).
//
// When FCM send infrastructure lands on the server side, add an `fcm_token`
// column (or a separate `fcm_device_tokens` table) and start persisting
// here. Until then we log a Sentry breadcrumb so we can see registration
// volume.
//
// See migration/SHIM_README.md and migration/flutter-usage.md row 2.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { legacyOk, parseLegacyForm, field } from "@/lib/mobile-shim"

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const token = field(form, "device_id").trim()

    Sentry.addBreadcrumb({
      category: "mobile-shim",
      level: "info",
      message: "device_token_update received",
      data: { tokenPresent: token.length > 0, tokenLen: token.length },
    })

    // Legacy contract — return success even when no token; the Flutter
    // client doesn't read this response anyway.
    return legacyOk("OK")
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/device_token_update" } })
    return legacyOk("OK")
  }
}

export const GET = POST

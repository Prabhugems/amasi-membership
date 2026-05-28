// @auth: public — legacy mobile shim. The Flutter "CREATE FRESH" button
// (member_application.dart:6921) fires this with the user's existing
// application id when they choose to discard a prior draft and start over.
// Flutter ignores the response and proceeds to /send_otp regardless.
//
// We delete only if status is in a safe-to-discard set
// (pending_review / need_clarification / resubmit_requested). Approved
// and rejected applications are preserved — they're records of fact
// and the user has no business deleting them via mobile. The Flutter
// flow doesn't surface the refusal (it ignores the response), but the
// downstream /send_otp call will land cleanly because creating a fresh
// app doesn't depend on the old one's removal.
//
// See migration/SHIM_README.md.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

const DELETABLE_STATUSES = new Set([
  "pending_review",
  "need_clarification",
  "resubmit_requested",
])

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`shim-delete-old-app:${ip}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many requests. Please try again later.")
    }

    const form = await parseLegacyForm(request)
    const id = field(form, "id").trim()
    if (!id) return legacyErr("Id is required")

    const supabase = createAdminClient()

    const { data: app, error: lookupErr } = await supabase
      .from("membership_applications")
      .select("id, status")
      .eq("id", id)
      .limit(1)
      .maybeSingle()

    if (lookupErr) {
      Sentry.captureException(lookupErr, {
        tags: { route: "shim/delete_old_member_application", phase: "lookup" },
      })
      return legacyErr("Something went wrong")
    }

    if (!app) {
      // Idempotent — nothing to delete; legacy clients treated this as success.
      return legacyOk("OK")
    }

    if (!DELETABLE_STATUSES.has(app.status)) {
      Sentry.addBreadcrumb({
        category: "mobile-shim",
        level: "warning",
        message: "delete_old_member_application refused for protected status",
        data: { id: app.id, status: app.status },
      })
      return legacyErr(
        "Cannot delete this application — it has already been processed."
      )
    }

    const { error: delErr } = await supabase
      .from("membership_applications")
      .delete()
      .eq("id", id)
      .in("status", Array.from(DELETABLE_STATUSES))

    if (delErr) {
      Sentry.captureException(delErr, {
        tags: { route: "shim/delete_old_member_application", phase: "delete" },
      })
      return legacyErr("Failed to delete application")
    }

    return legacyOk("OK")
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "shim/delete_old_member_application" },
    })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST

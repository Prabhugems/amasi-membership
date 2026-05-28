// @auth: public — legacy mobile shim. The Flutter Track Application
// details screen (lib/view/application/application_track_details.dart:235)
// posts `member_id` and renders the response as a status-change timeline.
//
// Legacy backend joined tbl_member_activity with tbl_status_master to
// produce {status_name, message, created_on} rows. In the new schema the
// audit ledger is `membership_audit_log`. We filter to rows where the
// entity_id matches the supplied id (matches both `member_id` lookups
// when the member is the entity, and application-level events when the
// caller supplied an application id by mistake), and project the result
// into the legacy shape.
//
// See migration/SHIM_README.md and migration/flutter-usage.md row 17.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

// Pretty-name a couple of common audit actions for the timeline.
function actionLabel(action: string | null | undefined): string {
  switch ((action ?? "").toLowerCase()) {
    case "approve":
    case "approved":
      return "Application Approved"
    case "reject":
    case "rejected":
      return "Application Rejected"
    case "clarification_requested":
    case "needs_clarification":
      return "Clarification Requested"
    case "submit":
    case "submitted":
      return "Application Submitted"
    case "resubmit":
    case "resubmitted":
      return "Application Resubmitted"
    case "payment_received":
    case "paid":
      return "Payment Received"
    case "created":
    case "draft_created":
      return "Application Created"
    case "updated":
      return "Application Updated"
    default:
      return action ? String(action) : "Activity"
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const memberId = field(form, "member_id").trim()
    if (!memberId) return legacyErr("member_id is required")

    const supabase = createAdminClient()

    // Audit rows for application-level events are keyed by the
    // application id, NOT the member id. Resolve any application ids
    // owned by this member so the timeline includes both member-entity
    // events AND application-entity events.
    const { data: apps } = await supabase
      .from("membership_applications")
      .select("id")
      .eq("member_id", memberId)

    const ids = [memberId, ...(apps ?? []).map((a) => a.id)]

    const { data: activity, error } = await supabase
      .from("membership_audit_log")
      .select("id, entity_type, entity_id, action, performed_by, created_at, new_data")
      .in("entity_id", ids)
      .order("created_at", { ascending: false })
      .limit(50)

    if (error) {
      Sentry.captureException(error, {
        tags: { route: "shim/get_member_activity", phase: "audit-lookup" },
      })
      return legacyErr("Something went wrong")
    }

    const rows = (activity ?? []).map((a) => ({
      id: a.id,
      status_name: actionLabel(a.action),
      message: actionLabel(a.action),
      created_on: a.created_at,
      created_by: a.performed_by ?? "system",
    }))

    return legacyOk("OK", { data: rows })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/get_member_activity" } })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST

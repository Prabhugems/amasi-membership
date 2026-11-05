// @auth: admin
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import { getApplicationById } from "@/lib/mou/supabase-helpers"

const MIN_REASON = 5
const MAX_REASON = 1000

// Cancels an approved MOU whose event is being called off. Unlike delete, the
// application stays on record with who cancelled it, when and why; the linked
// event (if any) is cancelled and closed to registration the same way the
// routing route does for "No event (MOU only)".
//
// Only "approved" can be cancelled: a "completed" event already happened, and
// pending/rejected applications have nothing to call off.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const { id } = await params

  let body: { reason?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json({ status: false, message: "Invalid JSON" }, { status: 400 })
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  if (reason.length < MIN_REASON) {
    return Response.json({ status: false, message: "Please give a reason for cancelling." }, { status: 400 })
  }
  if (reason.length > MAX_REASON) {
    return Response.json({ status: false, message: `Reason must be ${MAX_REASON} characters or fewer.` }, { status: 400 })
  }

  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })
  if (application.status !== "approved") {
    return Response.json(
      { status: false, message: `Only approved applications can be cancelled (this one is ${application.status}).` },
      { status: 400 }
    )
  }

  const adminEmail = (session.email as string) || "unknown"
  const nowIso = new Date().toISOString()
  const supabase = createAdminClient()

  // Compare-and-set on status so two admins (or the daily auto-complete job)
  // can't both act on the same row.
  const { data: updated, error } = await supabase
    .from("academic_event_applications")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
      cancelled_by: adminEmail,
      cancellation_reason: reason,
      updated_at: nowIso,
    })
    .eq("id", id)
    .eq("status", "approved")
    .select("id")
    .maybeSingle()

  if (error) {
    console.error(`[mou-cancel] update failed for application ${id}:`, error)
    Sentry.captureException(error, { tags: { component: "mou-cancel", op: "update" }, extra: { id } })
    return Response.json({ status: false, message: "Failed to cancel the application" }, { status: 500 })
  }
  if (!updated) {
    return Response.json({ status: false, message: "This application changed while you were cancelling it — reload and check." }, { status: 409 })
  }

  let eventCancelled: boolean | null = null
  if (application.created_event_id) {
    const { error: eventError } = await supabase
      .from("events")
      .update({ status: "cancelled", registration_open: false, updated_at: nowIso })
      .eq("id", application.created_event_id)
    eventCancelled = !eventError
    if (eventError) {
      // The MOU is already cancelled; report the half-done state instead of hiding it.
      console.error(`[mou-cancel] event cancel failed for application ${id}:`, eventError.message)
      Sentry.captureException(eventError, {
        tags: { component: "mou-cancel", op: "cancel-event" },
        extra: { id, eventId: application.created_event_id },
      })
    }
  }

  await logAdminAction({
    adminEmail,
    adminName: (session.name as string) || undefined,
    action: "mou_application_cancelled",
    entityType: "academic_event_application",
    entityId: id,
    entityName: application.event_name || application.organizer_name,
    details: { reason, event_id: application.created_event_id, event_cancelled: eventCancelled },
  })

  return Response.json({ status: true, eventCancelled })
}

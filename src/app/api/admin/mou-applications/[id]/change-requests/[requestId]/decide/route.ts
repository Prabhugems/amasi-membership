// @auth: admin — approve or decline an applicant's "Request a change"
// (date/venue/faculty) on an already-approved/completed MOU application.
// On approval: updates the application's finalized_date/faculty and, if an
// event was already created, the linked event's date/venue via
// syncEventDateVenue. mou-report-reminders.ts needs no changes — it
// already reads finalized_date with a fallback, and approved/completed
// applications are always in its scope regardless of how that date was set.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { getApplicationById } from "@/lib/mou/supabase-helpers"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { syncEventDateVenue } from "@/lib/mou/event-routing"
import { sendChangeRequestOutcomeEmail } from "@/lib/mou/notify"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"

const VALID_ACTIONS = new Set(["approved", "declined"])
const MAX_NOTE_LENGTH = 1000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const { id, requestId } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ status: false, message: "Invalid request" }, { status: 400 })
  }
  const action = body.action
  if (typeof action !== "string" || !VALID_ACTIONS.has(action)) {
    return Response.json({ status: false, message: "action must be 'approved' or 'declined'" }, { status: 400 })
  }
  const decisionNote =
    typeof body.decisionNote === "string" ? body.decisionNote.trim().slice(0, MAX_NOTE_LENGTH) : null

  const supabase = createAdminClient()
  const { data: changeRequest, error: fetchError } = await supabase
    .from("academic_event_change_requests")
    .select("*")
    .eq("id", requestId)
    .eq("application_id", id)
    .single()
  if (fetchError || !changeRequest) {
    return Response.json({ status: false, message: "Change request not found" }, { status: 404 })
  }
  if (changeRequest.status !== "pending") {
    return Response.json({ status: false, message: "This change request has already been decided" }, { status: 400 })
  }

  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Application not found" }, { status: 404 })

  const { error: decideError } = await supabase
    .from("academic_event_change_requests")
    .update({
      status: action,
      decided_by: typeof session.email === "string" ? session.email : "admin",
      decided_at: new Date().toISOString(),
      decision_note: decisionNote,
    })
    .eq("id", requestId)
  if (decideError) {
    console.error(`[mou-change-request-decide] update failed for request ${requestId}:`, decideError.message)
    Sentry.captureException(new Error(decideError.message), {
      tags: { component: "mou-change-request-decide", op: "update-request" },
      extra: { applicationId: id, requestId },
    })
    return Response.json({ status: false, message: "Failed to save decision" }, { status: 500 })
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {}
  if (action === "approved") {
    const appFields: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (changeRequest.requested_date) {
      changes.finalized_date = { from: application.finalized_date, to: changeRequest.requested_date }
      appFields.finalized_date = changeRequest.requested_date
    }
    if (changeRequest.requested_faculty) {
      changes.faculty = { from: application.faculty, to: changeRequest.requested_faculty }
      appFields.faculty = changeRequest.requested_faculty
    }
    const venue = changeRequest.requested_venue as Record<string, unknown> | null
    if (venue) {
      for (const key of ["venue_name", "venue_address", "venue_city", "venue_state", "venue_zip", "venue_country"]) {
        if (venue[key] !== undefined) {
          changes[key] = { from: (application as unknown as Record<string, unknown>)[key], to: venue[key] }
          appFields[key] = venue[key]
        }
      }
    }

    if (Object.keys(appFields).length > 1) {
      const { error: appUpdateError } = await supabase
        .from("academic_event_applications")
        .update(appFields)
        .eq("id", id)
      if (appUpdateError) {
        console.error(`[mou-change-request-decide] application update failed for ${id}:`, appUpdateError.message)
        Sentry.captureException(new Error(appUpdateError.message), {
          tags: { component: "mou-change-request-decide", op: "update-application" },
          extra: { applicationId: id, requestId },
        })
      }
    }

    if (application.created_event_id) {
      const synced = await syncEventDateVenue(supabase, application.created_event_id, {
        startDate: changeRequest.requested_date ?? undefined,
        endDate: changeRequest.requested_date ?? undefined,
        venueName: venue?.venue_name as string | undefined,
        city: venue?.venue_city as string | undefined,
        state: venue?.venue_state as string | undefined,
      })
      if (!synced) {
        Sentry.captureException(new Error("syncEventDateVenue failed"), {
          tags: { component: "mou-change-request-decide", op: "sync-event" },
          extra: { applicationId: id, eventId: application.created_event_id },
        })
      }
    }
  }

  const typeConfig = getEventTypeConfig(application.application_type_id)
  const typeLabel = typeConfig?.label ?? application.application_type_id
  try {
    await sendChangeRequestOutcomeEmail(application, typeLabel, action as "approved" | "declined", decisionNote)
  } catch (err) {
    console.error(`[mou-change-request-decide] applicant notification failed for ${id}:`, err)
    Sentry.captureException(err, {
      tags: { component: "mou-change-request-decide", op: "notify-applicant" },
      extra: { applicationId: id, requestId },
    })
  }

  await logAdminAction({
    adminEmail: typeof session.email === "string" ? session.email : "admin@amasi.org",
    adminName: typeof session.name === "string" ? session.name : undefined,
    action: "mou_change_request_decided",
    entityType: "academic_event_application",
    entityId: id,
    details: { changes, fieldCount: Object.keys(changes).length, requestId, decision: action },
  })

  return Response.json({ status: true })
}

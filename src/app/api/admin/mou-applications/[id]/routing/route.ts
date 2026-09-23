// @auth: admin — overrides which entity (AMASI / College of MAS) an
// application's event opens under, or whether it should have no event at
// all. Independent of the Hon. Secretary's approve/reject decision;
// admin-settable before or after approval. Locked once the linked event
// has any real registrations/ticket sales — see the lock check below.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { getApplicationById, getRoleAssignment } from "@/lib/mou/supabase-helpers"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { createEventForApplication, isEventRoutingLocked } from "@/lib/mou/event-routing"
import { DIRECTOR_ROLE_BY_APPLICATION_TYPE } from "@/lib/mou/director-roles"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"

const VALID_ROUTINGS = new Set(["amasi", "college", "none"])

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ status: false, message: "Invalid request" }, { status: 400 })
  }
  if (typeof body.eventRouting !== "string" || !VALID_ROUTINGS.has(body.eventRouting)) {
    return Response.json({ status: false, message: "eventRouting must be 'amasi', 'college', or 'none'" }, { status: 400 })
  }
  const to = body.eventRouting as "amasi" | "college" | "none"

  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  const from = application.event_routing
  if (from === to) {
    return Response.json({ status: true, eventRouting: to, changed: false })
  }

  const supabase = createAdminClient()

  if (await isEventRoutingLocked(supabase, application.created_event_id)) {
    return Response.json(
      { status: false, message: "This event already has registrations or ticket sales — routing can no longer be changed." },
      { status: 400 }
    )
  }

  let eventSynced = false
  let newEventId: string | null = null

  if (application.created_event_id) {
    // An event already exists — move it, or cancel/un-cancel it.
    if (to === "none") {
      const { error } = await supabase
        .from("events")
        .update({ status: "cancelled", registration_open: false, updated_at: new Date().toISOString() })
        .eq("id", application.created_event_id)
      eventSynced = !error
      if (error) console.error(`[mou-routing] cancel event failed for application ${id}:`, error.message)
    } else if (from === "none") {
      // Un-cancelling a previously-cancelled event, not creating a
      // duplicate. syncEventRegistration only nudges a *draft* event to
      // registration_open — a cancelled event needs an explicit
      // reactivation, so that's set directly here instead.
      const { error } = await supabase
        .from("events")
        .update({ tenant: to, status: "registration_open", registration_open: true, updated_at: new Date().toISOString() })
        .eq("id", application.created_event_id)
      eventSynced = !error
      if (error) console.error(`[mou-routing] reactivate event failed for application ${id}:`, error.message)
    } else {
      // amasi <-> college, event already live — just moves tenant.
      const { error } = await supabase
        .from("events")
        .update({ tenant: to, updated_at: new Date().toISOString() })
        .eq("id", application.created_event_id)
      eventSynced = !error
      if (error) console.error(`[mou-routing] move tenant failed for application ${id}:`, error.message)
    }
  } else if (to !== "none" && (application.status === "approved" || application.status === "completed")) {
    // No event yet, application already approved, routing turned ON —
    // create the event now, the same way approval would have if this
    // routing had been set at decide-time. Mirrors decide/route.ts's
    // organiser/director invite step.
    const typeLabel = getEventTypeConfig(application.application_type_id)?.label ?? application.application_type_id
    const result = await createEventForApplication({ ...application, event_routing: to }, typeLabel)
    if ("eventId" in result) {
      newEventId = result.eventId
      eventSynced = true
      try {
        await supabase.from("team_invitations").insert({
          email: application.email,
          name: application.organizer_name,
          role: "coordinator",
          event_ids: [result.eventId],
        })
      } catch (err) {
        Sentry.captureException(err, { tags: { component: "mou-routing", op: "invite-organiser" }, extra: { applicationId: id } })
      }
      const directorRole = DIRECTOR_ROLE_BY_APPLICATION_TYPE[application.application_type_id]
      if (directorRole) {
        try {
          const director = await getRoleAssignment(directorRole)
          if (director) {
            await supabase.from("team_invitations").insert({
              email: director.email,
              name: director.name,
              role: "coordinator",
              event_ids: [result.eventId],
            })
          }
        } catch (err) {
          Sentry.captureException(err, { tags: { component: "mou-routing", op: "invite-director" }, extra: { applicationId: id } })
        }
      }
    } else {
      console.error(`[mou-routing] event create failed for application ${id}:`, result.error)
      Sentry.captureException(new Error(result.error), { tags: { component: "mou-routing", op: "create-event" }, extra: { applicationId: id } })
    }
  }
  // else: no event yet, application not approved yet, or routing turned to
  // 'none' with nothing to cancel — just the application row changes;
  // decide/route.ts will read the new event_routing whenever it's approved.

  const { error: updateError } = await supabase
    .from("academic_event_applications")
    .update({
      event_routing: to,
      ...(newEventId ? { created_event_id: newEventId } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
  if (updateError) {
    console.error(`[mou-routing] update failed for application ${id}:`, updateError.message)
    return Response.json({ status: false, message: "Failed to save" }, { status: 500 })
  }

  const adminEmail = typeof session.email === "string" ? session.email : "admin@amasi.org"
  await logAdminAction({
    adminEmail,
    adminName: typeof session.name === "string" ? session.name : undefined,
    action: "mou_event_routing_changed",
    entityType: "academic_event_application",
    entityId: id,
    details: { changes: { event_routing: { from, to } }, fieldCount: 1, eventSynced, eventId: newEventId ?? application.created_event_id },
  })

  return Response.json({ status: true, eventRouting: to, changed: true, eventSynced })
}

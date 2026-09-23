// @auth: admin — recovers from a failed best-effort event auto-create
// (decide/route.ts's createEventForApplication can fail without rolling
// back the Secretary's decision; this is the manual re-trigger for that
// state). Idempotent: re-checks created_event_id is still null immediately
// before creating, so a double-click can't produce two events for the
// same application.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { getApplicationById, getRoleAssignment } from "@/lib/mou/supabase-helpers"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { createEventForApplication } from "@/lib/mou/event-routing"
import { DIRECTOR_ROLE_BY_APPLICATION_TYPE } from "@/lib/mou/director-roles"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  if (application.status !== "approved" && application.status !== "completed") {
    return Response.json({ status: false, message: "Application isn't approved — nothing to retry." }, { status: 400 })
  }
  if (application.event_routing === "none") {
    return Response.json({ status: false, message: "This application's routing is 'none' — it shouldn't have an event." }, { status: 400 })
  }
  if (application.created_event_id) {
    return Response.json({ status: false, message: "An event already exists for this application." }, { status: 400 })
  }

  const typeLabel = getEventTypeConfig(application.application_type_id)?.label ?? application.application_type_id
  const result = await createEventForApplication(application, typeLabel)
  if (!("eventId" in result)) {
    console.error(`[mou-retry-event] create failed for application ${id}:`, result.error)
    Sentry.captureException(new Error(result.error), { tags: { component: "mou-retry-event" }, extra: { applicationId: id } })
    return Response.json({ status: false, message: "Event creation failed again — see Sentry for details." }, { status: 500 })
  }

  const supabase = createAdminClient()
  // The idempotency guard: only claims this if created_event_id is still
  // null, so a near-simultaneous second click doesn't leave a dangling
  // stray event referenced by nothing.
  const { data: claimed } = await supabase
    .from("academic_event_applications")
    .update({ created_event_id: result.eventId, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("created_event_id", null)
    .select("id")
    .maybeSingle()

  if (!claimed) {
    return Response.json(
      { status: false, message: "An event was already created for this application by another request." },
      { status: 409 }
    )
  }

  try {
    await supabase.from("team_invitations").insert({
      email: application.email,
      name: application.organizer_name,
      role: "coordinator",
      event_ids: [result.eventId],
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { component: "mou-retry-event", op: "invite-organiser" }, extra: { applicationId: id } })
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
      Sentry.captureException(err, { tags: { component: "mou-retry-event", op: "invite-director" }, extra: { applicationId: id } })
    }
  }

  const adminEmail = typeof session.email === "string" ? session.email : "admin@amasi.org"
  await logAdminAction({
    adminEmail,
    adminName: typeof session.name === "string" ? session.name : undefined,
    action: "mou_event_retry_created",
    entityType: "academic_event_application",
    entityId: id,
    details: { eventId: result.eventId },
  })

  return Response.json({ status: true, eventId: result.eventId })
}

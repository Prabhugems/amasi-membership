// @auth: admin — sets whether AMASI needs to open registration for this
// event in the shared events system, or not (rural camps/blood donation
// camps typically don't; workshops/courses usually do — not a fixed
// per-type rule, an admin decides per application). Independent of the
// Hon. Secretary's approve/reject decision.
import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { getApplicationById } from "@/lib/mou/supabase-helpers"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"

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
  if (typeof body.registrationRequired !== "boolean") {
    return Response.json({ status: false, message: "registrationRequired (boolean) is required" }, { status: 400 })
  }
  const registrationRequired = body.registrationRequired

  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("academic_event_applications")
    .update({ registration_required: registrationRequired, updated_at: new Date().toISOString() })
    .eq("id", id)
  if (error) {
    console.error(`[mou-registration] update failed for application ${id}:`, error.message)
    return Response.json({ status: false, message: "Failed to save" }, { status: 500 })
  }

  // Sync onto the shared `events` row this application auto-created on
  // approval (decide/route.ts) — the same table amasi-faculty-management's
  // own dashboard reads from. Only touches registration_open and, when
  // turning registration ON, nudges a still-draft event to
  // registration_open; turning it OFF never moves status backward — the
  // event may already be further along (active/ongoing) for reasons
  // unrelated to registration.
  let eventSynced = false
  if (application.created_event_id) {
    const { data: eventRow } = await supabase
      .from("events")
      .select("status")
      .eq("id", application.created_event_id)
      .maybeSingle()

    const eventUpdate: Record<string, unknown> = { registration_open: registrationRequired, updated_at: new Date().toISOString() }
    if (registrationRequired && eventRow?.status === "draft") {
      eventUpdate.status = "registration_open"
    }

    const { error: eventError } = await supabase
      .from("events")
      .update(eventUpdate)
      .eq("id", application.created_event_id)
    if (eventError) {
      console.error(`[mou-registration] events sync failed for application ${id}:`, eventError.message)
    } else {
      eventSynced = true
    }
  }

  const adminEmail = typeof session.email === "string" ? session.email : "admin@amasi.org"
  await logAdminAction({
    adminEmail,
    adminName: typeof session.name === "string" ? session.name : undefined,
    action: "mou_registration_required_set",
    entityType: "academic_event_application",
    entityId: id,
    details: { registration_required: registrationRequired, event_synced: eventSynced, event_id: application.created_event_id },
  })

  return Response.json({ status: true, registrationRequired, eventSynced })
}

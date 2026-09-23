import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase"
import type { AcademicEventApplication, ApplicationTypeId } from "./types"

export type EventRouting = "amasi" | "college" | "none"

// Mirrors sql/048 + sql/050's seed. Used as the default at submission time when the
// academic_event_types row can't be read, and as a defensive fallback
// inside createEventForApplication for any pre-migration application row
// that somehow still has a null event_routing.
const FALLBACK_ROUTING_BY_APPLICATION_TYPE: Record<ApplicationTypeId, EventRouting> = {
  fmas: "college",
  mmas: "college",
  dmas: "college",
  rural_program: "none",
  blood_donation: "none",
  workshop: "amasi",
  amasicon: "none",
  slcp: "amasi",
  nextgen: "amasi",
  meet_the_master: "amasi",
  zonal_event: "amasi",
}

/** Read academic_event_types.default_event_routing for one type, falling back to the static map above if the row can't be read. */
export async function getDefaultEventRouting(applicationTypeId: ApplicationTypeId): Promise<EventRouting> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("academic_event_types")
    .select("default_event_routing")
    .eq("id", applicationTypeId)
    .maybeSingle()
  const routing = data?.default_event_routing as EventRouting | undefined
  return routing ?? FALLBACK_ROUTING_BY_APPLICATION_TYPE[applicationTypeId] ?? "amasi"
}

// public.events.event_type is a Postgres enum (conference | course | workshop
// | webinar | symposium) with NOT NULL + a 'conference' default — confirmed
// against the live shared DB (project jmdwxymbgxwdsmcwbahp). Map our
// application types onto it so the amasi-faculty-management dashboard shows
// a plausible category instead of every auto-created event defaulting to
// "conference".
const EVENT_TYPE_BY_APPLICATION_TYPE: Record<ApplicationTypeId, "conference" | "course" | "workshop" | "webinar" | "symposium"> = {
  fmas: "course",
  mmas: "course",
  dmas: "course",
  workshop: "workshop",
  amasicon: "conference",
  rural_program: "workshop",
  blood_donation: "workshop",
  slcp: "workshop",
  nextgen: "workshop",
  meet_the_master: "workshop",
  zonal_event: "conference",
}

// public.events.created_by (nullable, no default) was never set by the
// original insert — every auto-created event sat with created_by=null.
// events.amasi.org's dashboard scopes its Events list to events the
// logged-in admin created (confirmed live). There's no "system" service
// account in that app's `users` table to attribute these to instead, so
// this is the confirmed AMASI super_admin account (users.id,
// platform_role='super_admin') — a workaround for a missing system-account
// concept there, not a claim that this person personally created every
// approved event.
export const EVENT_CREATED_BY_USER_ID = "d316e077-9f56-4e58-aff7-c4c367c77f9d"

// public.events.slug is NOT NULL + UNIQUE with no default — an insert
// without one fails outright. Derive one from the event name and make it
// unique by suffixing a fragment of the (already-unique) application id,
// so two similarly-named approvals never collide.
function buildEventSlug(name: string, applicationId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  const suffix = applicationId.replace(/-/g, "").slice(0, 8)
  return `${base || "event"}-${suffix}`
}

/**
 * Create the shared-events-table row for an approved application whose
 * event_routing is 'amasi' or 'college' — the single source of this insert,
 * used by the approval path, the admin "Retry create event" action, and the
 * admin routing override's none→amasi/college transition. Never throws —
 * callers treat this as a best-effort side effect (log to Sentry, keep
 * going) per the existing posture in decide/route.ts.
 */
export async function createEventForApplication(
  application: AcademicEventApplication,
  typeLabel: string
): Promise<{ eventId: string } | { error: string }> {
  const routing = application.event_routing ?? FALLBACK_ROUTING_BY_APPLICATION_TYPE[application.application_type_id] ?? "amasi"
  if (routing === "none") {
    return { error: "event_routing is 'none' — no event should be created for this application" }
  }

  const supabase = createAdminClient()
  const eventName = application.event_name || `${typeLabel} — ${application.organizer_name}`
  const { data: eventRow, error } = await supabase
    .from("events")
    .insert({
      name: eventName,
      short_name: typeLabel,
      slug: buildEventSlug(eventName, application.id),
      event_type: EVENT_TYPE_BY_APPLICATION_TYPE[application.application_type_id] ?? "conference",
      tenant: routing,
      created_by: EVENT_CREATED_BY_USER_ID,
      description: `${typeLabel} hosted by ${application.organizer_name} at ${application.primary_institution}`,
      start_date: application.finalized_date || application.preferred_date_1,
      end_date: application.finalized_date || application.preferred_date_1,
      venue_name: application.venue_name,
      city: application.venue_city,
      state: application.venue_state,
      country: application.venue_country || "India",
      timezone: "Asia/Kolkata",
      // Auto-open — the admin's separate registration toggle (still wired
      // up for pre-existing rows and edge cases) is no longer required for
      // a fresh routed approval.
      registration_open: true,
      status: "registration_open",
    })
    .select("id")
    .single()

  if (error || !eventRow) {
    return { error: error?.message || "event insert returned no row" }
  }
  return { eventId: eventRow.id }
}

/**
 * True once the linked event has any real registrations or ticket sales —
 * the point past which routing (and the admin registration toggle) should
 * no longer be changeable. Shared by the admin detail GET route (so the UI
 * can disable the selector up front) and the routing PATCH route (which
 * re-checks server-side rather than trusting the client).
 */
export async function isEventRoutingLocked(supabase: SupabaseClient, eventId: string | null): Promise<boolean> {
  if (!eventId) return false
  const [{ count: regCount }, { data: soldTickets }] = await Promise.all([
    supabase.from("registrations").select("id", { count: "exact", head: true }).eq("event_id", eventId),
    supabase.from("ticket_types").select("quantity_sold").eq("event_id", eventId).gt("quantity_sold", 0).limit(1),
  ])
  return (regCount ?? 0) > 0 || (soldTickets?.length ?? 0) > 0
}

/**
 * Toggle registration_open on an EXISTING event, nudging a still-draft
 * event to registration_open status when turning it on. Turning it off
 * never moves status backward — the event may already be further along
 * (active/ongoing) for reasons unrelated to registration. Extracted from
 * the original PATCH .../registration handler so the admin routing
 * override can reuse the same logic when un-cancelling an event.
 */
export async function syncEventRegistration(
  supabase: SupabaseClient,
  eventId: string,
  open: boolean
): Promise<boolean> {
  const { data: eventRow } = await supabase
    .from("events")
    .select("status")
    .eq("id", eventId)
    .maybeSingle()

  const eventUpdate: Record<string, unknown> = { registration_open: open, updated_at: new Date().toISOString() }
  if (open && eventRow?.status === "draft") {
    eventUpdate.status = "registration_open"
  }

  const { error } = await supabase.from("events").update(eventUpdate).eq("id", eventId)
  return !error
}

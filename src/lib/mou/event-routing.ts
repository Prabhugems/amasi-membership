import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase"
import { getRoleAssignment } from "./supabase-helpers"
import { DIRECTOR_ROLE_BY_APPLICATION_TYPE } from "./director-roles"
import type { AcademicEventApplication, ApplicationTypeId } from "./types"

export type EventRouting = "amasi" | "college" | "none"

// Tenant -> live app domain for the created event. Mirrors
// amasi-faculty-management's own src/lib/tenant.ts, which this app has no
// equivalent of. Found missing 2026-09-29 while fixing the coordinator
// invite email below: the outcome email's eventsUrl was hardcoded to
// events.amasi.org regardless of routing, which is wrong for every
// 'college'-routed approval (FMAS/MMAS/DMAS default there — see
// FALLBACK_ROUTING_BY_APPLICATION_TYPE above) since those events actually
// live on collegeofmas.org.in, not events.amasi.org.
const APP_URL_BY_TENANT: Record<"amasi" | "college", string> = {
  amasi: "https://events.amasi.org",
  college: "https://collegeofmas.org.in",
}

export function eventAppUrl(tenant: "amasi" | "college"): string {
  return APP_URL_BY_TENANT[tenant]
}

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

// The events.amasi.org card shows `short_name` as its title (preferred over
// `name` whenever set — see that repo's src/app/events/page.tsx), and
// short_name was previously just `typeLabel` verbatim — every FMAS card
// literally read "FMAS Course", identical and undistinguishable from every
// other FMAS card. application.event_name already tends to carry whatever
// course number the applicant typed in (e.g. "128 FMAS Course", "31 AMASI
// NextGen") — reuse that rather than inventing new numbering logic, and
// append city/state for the cases where event_name was left blank
// (falls back to typeLabel alone, same as before, just with a city added).
function buildEventShortName(application: AcademicEventApplication, typeLabel: string): string {
  const base = application.event_name || typeLabel
  const location = application.venue_city
    ? `${application.venue_city}${application.venue_state ? `, ${application.venue_state}` : ""}`
    : null
  return location ? `${base} — ${location}` : base
}

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
): Promise<{ eventId: string; tenant: "amasi" | "college" } | { error: string }> {
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
      short_name: buildEventShortName(application, typeLabel),
      // New column (AMASI-management migration 20260923_events_organizer_name.sql)
      // — the events-list card subtitle prefers this over its old "name,
      // when it differs from short_name" diff-check.
      organizer_name: application.organizer_name,
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
  // Safe cast: the "none" case already returned above, so routing is
  // narrowed to "amasi" | "college" here.
  return { eventId: eventRow.id, tenant: routing as "amasi" | "college" }
}

/**
 * Insert the team_invitations row for a new event's organiser/director AND
 * actually send the invite email — previously only the insert happened,
 * duplicated inline in three places (this function replaces all three: the
 * approval decide route, the admin "Retry create event" action, and the
 * admin routing-override route). The applicant/director was told "check
 * your inbox for that invite" (src/lib/mou/notify.ts's sendOutcomeEmail)
 * but no such email was ever sent — found 2026-09-29.
 *
 * The inserted row's own DB defaults (status='pending', expires_at=+7d, a
 * fresh random token via team_invitations.token's column default) are
 * already correct and accepted by amasi-faculty-management's
 * /api/team/invite/[id]/accept route as-is — confirmed directly against
 * that route and the live schema — so the only missing piece was this
 * email, not the row's shape.
 *
 * Throws on either the insert or the email failing. Callers already wrap
 * this in their own try/catch + Sentry.captureException with a call-site-
 * specific `component` tag (mou-decide / mou-retry-event / mou-routing),
 * so this stays a thin, throwing helper rather than swallowing errors and
 * losing that per-route observability.
 */
export async function inviteEventCoordinator(
  supabase: SupabaseClient,
  opts: { email: string; name: string | null; eventId: string; eventName: string; tenant: "amasi" | "college" }
): Promise<void> {
  const { data, error } = await supabase
    .from("team_invitations")
    .insert({
      email: opts.email,
      name: opts.name,
      role: "coordinator",
      event_ids: [opts.eventId],
    })
    .select("token")
    .single()
  if (error || !data) {
    throw new Error(error?.message || "team_invitations insert returned no row")
  }
  const inviteLink = `${eventAppUrl(opts.tenant)}/team/accept-invite?token=${data.token}`
  const { sendCoordinatorInviteEmail } = await import("./notify")
  await sendCoordinatorInviteEmail(opts.email, opts.name, opts.eventName, inviteLink)
}

/**
 * FYI-only notice to the National Director for this application's type, if
 * one exists — no team_invitations row, no coordinator access. Reverted to
 * this 2026-09-29 on explicit instruction, replacing an earlier version
 * that invited the director as a coordinator via inviteEventCoordinator:
 * directors get information, only the applicant becomes a team member.
 * A no-op when the application type has no director seat (see
 * DIRECTOR_ROLE_BY_APPLICATION_TYPE — only fmas/nextgen/slcp have one) or
 * when no one is currently assigned to that role. Never throws — same
 * best-effort posture as the rest of this file; callers don't need their
 * own try/catch, this one swallows and logs internally since a missed FYI
 * is lower-stakes than a missed coordinator invite.
 */
export async function notifyEventDirector(
  application: AcademicEventApplication,
  typeLabel: string,
  eventName: string
): Promise<void> {
  const directorRole = DIRECTOR_ROLE_BY_APPLICATION_TYPE[application.application_type_id]
  if (!directorRole) return
  try {
    const director = await getRoleAssignment(directorRole)
    if (!director) return
    const { sendDirectorEventCreatedNotice } = await import("./notify")
    await sendDirectorEventCreatedNotice(director.email, director.name, eventName, typeLabel, application.organizer_name)
  } catch (err) {
    console.error(`[notifyEventDirector] failed for application ${application.id}:`, err)
    const Sentry = await import("@sentry/nextjs")
    Sentry.captureException(err, {
      tags: { component: "notify-event-director" },
      extra: { applicationId: application.id, directorRole },
    })
  }
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

/**
 * Push a new date/venue onto an already-created event — used only by the
 * "Request a change" flow (an approved/completed application's admin-
 * approved change request), which is the one place post-approval that a
 * date or venue can legitimately move. Only touches the fields explicitly
 * passed; omit a field to leave it unchanged. Never throws — same
 * best-effort posture as createEventForApplication.
 */
export async function syncEventDateVenue(
  supabase: SupabaseClient,
  eventId: string,
  changes: { startDate?: string; endDate?: string; venueName?: string; city?: string; state?: string }
): Promise<boolean> {
  const eventUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (changes.startDate !== undefined) eventUpdate.start_date = changes.startDate
  if (changes.endDate !== undefined) eventUpdate.end_date = changes.endDate
  if (changes.venueName !== undefined) eventUpdate.venue_name = changes.venueName
  if (changes.city !== undefined) eventUpdate.city = changes.city
  if (changes.state !== undefined) eventUpdate.state = changes.state

  const { error } = await supabase.from("events").update(eventUpdate).eq("id", eventId)
  return !error
}

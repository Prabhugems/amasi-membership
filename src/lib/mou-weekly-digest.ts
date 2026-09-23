import { createAdminClient } from "@/lib/supabase"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import type { AcademicEventApplication } from "@/lib/mou/types"

// Part B, item 7: a Monday-morning MOU-only digest, separate from
// src/app/api/cron/weekly-digest/route.ts's membership-KPI digest (decided
// with Prabhu 2026-09-23 — different audience, different content, no risk
// to that already-working email).

export interface AwaitingDecisionRow {
  id: string
  organizerName: string
  typeLabel: string
  daysWaiting: number
}

export interface ApprovedNoEventRow {
  id: string
  organizerName: string
  typeLabel: string
}

export interface UpcomingEventRow {
  applicationId: string
  eventId: string
  name: string
  startDate: string | null
  organizerName: string
}

export interface OverdueReportRow {
  id: string
  organizerName: string
  typeLabel: string
  eventDate: string | null
}

export interface AwaitingReviewRow {
  id: string
  organizerName: string
  typeLabel: string
  submittedAt: string | null
}

export interface MouDigestSections {
  awaitingDecision: AwaitingDecisionRow[]
  approvedNoEvent: ApprovedNoEventRow[]
  upcomingEvents: UpcomingEventRow[]
  overdueReports: OverdueReportRow[]
  awaitingReview: AwaitingReviewRow[]
  allEmpty: boolean
}

function typeLabelFor(app: Pick<AcademicEventApplication, "application_type_id">): string {
  return getEventTypeConfig(app.application_type_id)?.label ?? app.application_type_id
}

function daysBetween(from: string, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000)))
}

function eventDateOf(app: Pick<AcademicEventApplication, "finalized_date" | "preferred_date_1">): string | null {
  return app.finalized_date || app.preferred_date_1 || null
}

export async function buildMouDigestSections(): Promise<MouDigestSections> {
  const supabase = createAdminClient()
  const now = new Date()
  const twoWeeksOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const todayISO = now.toISOString().slice(0, 10)

  const [awaitingRes, approvedRes, overdueRes, reviewRes] = await Promise.all([
    // Awaiting Secretary decision.
    supabase
      .from("academic_event_applications")
      .select("id, organizer_name, application_type_id, created_at")
      .in("status", ["submitted", "under_review"])
      .order("created_at", { ascending: true }),

    // Approved but event not created — same condition the admin detail
    // route (src/app/api/admin/mou-applications/[id]/route.ts) computes
    // per-application; recomputed here in bulk.
    supabase
      .from("academic_event_applications")
      .select("id, organizer_name, application_type_id, status, event_routing, created_event_id")
      .in("status", ["approved", "completed"])
      .not("event_routing", "eq", "none")
      .is("created_event_id", null),

    // Reports overdue: past the day-15 reminder, still not filed. Uses the
    // same signal src/lib/mou-report-reminders.ts's stage 3 (escalation)
    // keys off — reminder_15_sent_at being set means the cron already
    // judged this event's date + 15 days has passed.
    supabase
      .from("academic_event_applications")
      .select("id, organizer_name, application_type_id, finalized_date, preferred_date_1")
      .not("report_reminder_15_sent_at", "is", null)
      .is("report_submitted_at", null),

    // Reports submitted, awaiting review.
    supabase
      .from("academic_event_applications")
      .select("id, organizer_name, application_type_id, report_submitted_at")
      .eq("report_status", "submitted"),
  ])

  if (awaitingRes.error) throw new Error(`digest: awaiting-decision query failed: ${awaitingRes.error.message}`)
  if (approvedRes.error) throw new Error(`digest: approved-no-event query failed: ${approvedRes.error.message}`)
  if (overdueRes.error) throw new Error(`digest: overdue-reports query failed: ${overdueRes.error.message}`)
  if (reviewRes.error) throw new Error(`digest: awaiting-review query failed: ${reviewRes.error.message}`)

  const awaitingDecision: AwaitingDecisionRow[] = (awaitingRes.data ?? []).map((a) => ({
    id: a.id,
    organizerName: a.organizer_name,
    typeLabel: typeLabelFor(a),
    daysWaiting: daysBetween(a.created_at, now),
  }))

  const approvedNoEvent: ApprovedNoEventRow[] = (approvedRes.data ?? []).map((a) => ({
    id: a.id,
    organizerName: a.organizer_name,
    typeLabel: typeLabelFor(a),
  }))

  const overdueReports: OverdueReportRow[] = (overdueRes.data ?? []).map((a) => ({
    id: a.id,
    organizerName: a.organizer_name,
    typeLabel: typeLabelFor(a),
    eventDate: eventDateOf(a),
  }))

  const awaitingReview: AwaitingReviewRow[] = (reviewRes.data ?? []).map((a) => ({
    id: a.id,
    organizerName: a.organizer_name,
    typeLabel: typeLabelFor(a),
    submittedAt: a.report_submitted_at,
  }))

  // Events this week and next: MOU-created events (created_event_id set)
  // whose start_date falls in [today, today+14d]. Two-step lookup —
  // academic_event_applications doesn't carry the event's own start_date,
  // only the application's preferred/finalized date, which can differ from
  // what actually got saved onto the events row.
  const { data: withEvents, error: withEventsError } = await supabase
    .from("academic_event_applications")
    .select("id, organizer_name, created_event_id")
    .not("created_event_id", "is", null)
  if (withEventsError) throw new Error(`digest: events-lookup query failed: ${withEventsError.message}`)

  const eventIds = (withEvents ?? []).map((a) => a.created_event_id as string)
  let upcomingEvents: UpcomingEventRow[] = []
  if (eventIds.length > 0) {
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("id, name, start_date, status")
      .in("id", eventIds)
      .gte("start_date", todayISO)
      .lte("start_date", twoWeeksOut)
      .neq("status", "cancelled")
    if (eventsError) throw new Error(`digest: events query failed: ${eventsError.message}`)

    const appByEventId = new Map((withEvents ?? []).map((a) => [a.created_event_id as string, a]))
    upcomingEvents = (events ?? []).map((e) => {
      const app = appByEventId.get(e.id)
      return {
        applicationId: app?.id ?? "",
        eventId: e.id,
        name: e.name,
        startDate: e.start_date,
        organizerName: app?.organizer_name ?? "",
      }
    })
  }

  const allEmpty =
    awaitingDecision.length === 0 &&
    approvedNoEvent.length === 0 &&
    upcomingEvents.length === 0 &&
    overdueReports.length === 0 &&
    awaitingReview.length === 0

  return { awaitingDecision, approvedNoEvent, upcomingEvents, overdueReports, awaitingReview, allEmpty }
}

import { createAdminClient } from "@/lib/supabase"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { sendOrganiserSetupStatusEmail, sendOrganiserEventReminderEmail } from "@/lib/mou/notify"
import type { AcademicEventApplication } from "@/lib/mou/types"

// Two organiser-facing reminders, scoped to FMAS/MMAS only (2026-09-29
// product decision — the two types whose events reliably need ticket
// setup after auto-creation; not extended to nextgen/slcp/workshop etc.
// without a separate decision):
//
//  1. A weekly "setup status" nudge from the week the event is auto-created
//     until the event happens, every week regardless of completion state
//     (see sendOrganiserSetupStatusEmail's own comment for why it's not
//     gated on being incomplete).
//  2. A one-time "3 days to go" email with the current delegate count.
//
// Both fire off the SAME candidate query shape as mou-report-reminders.ts
// (findCandidates + an atomic claim-before-send), scoped here to
// application_type_id in ('fmas','mmas') with a real created_event_id
// whose event hasn't happened yet.
const ORGANISER_REMINDER_TYPES = ["fmas", "mmas"] as const
export const EVENT_REMINDER_DAYS_AHEAD = 3

interface CandidateRow {
  application: AcademicEventApplication
  eventId: string
  eventName: string
  eventStartDate: string | null
}

async function findOpenEventApplications(): Promise<CandidateRow[]> {
  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: apps, error } = await supabase
    .from("academic_event_applications")
    .select("*")
    .in("application_type_id", ORGANISER_REMINDER_TYPES)
    .not("created_event_id", "is", null)

  if (error) throw new Error(`Fetch organiser-reminder candidates failed: ${error.message}`)
  if (!apps || apps.length === 0) return []

  const eventIds = apps.map((a) => a.created_event_id as string)
  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id, name, start_date, status")
    .in("id", eventIds)
    .gte("start_date", today)
    .neq("status", "cancelled")

  if (eventsError) throw new Error(`Fetch events for organiser reminders failed: ${eventsError.message}`)
  const eventById = new Map((events ?? []).map((e) => [e.id as string, e]))

  const rows: CandidateRow[] = []
  for (const app of apps as AcademicEventApplication[]) {
    const event = eventById.get(app.created_event_id as string)
    if (!event) continue // event already happened, cancelled, or missing
    rows.push({ application: app, eventId: event.id as string, eventName: (event.name as string).trim(), eventStartDate: event.start_date as string | null })
  }
  return rows
}

export interface SetupStatusResult {
  sent: number
  skipped: number
}

// Claim before sending — only fires if setup_status_last_sent_at is null OR
// more than 7 days old, and the conditional UPDATE only succeeds for a row
// still matching that (same overlapping-cron-run guard as
// mou-report-reminders.ts's claim()).
async function claimWeeklySlot(applicationId: string, cutoffIso: string): Promise<boolean> {
  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()
  const { data } = await supabase
    .from("academic_event_applications")
    .update({ setup_status_last_sent_at: nowIso })
    .eq("id", applicationId)
    .or(`setup_status_last_sent_at.is.null,setup_status_last_sent_at.lte.${cutoffIso}`)
    .select("id")
    .maybeSingle()
  return !!data
}

export async function runWeeklySetupStatusEmails(options: { dryRun?: boolean } = {}): Promise<SetupStatusResult> {
  const supabase = createAdminClient()
  const candidates = await findOpenEventApplications()
  // Whole-second precision (no milliseconds) — the mock's .or() parser
  // splits on ".", which breaks on a raw toISOString()'s ".738Z" suffix;
  // whole seconds are far more precision than a weekly cadence needs anyway.
  const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z")

  let sent = 0
  let skipped = 0

  for (const { application, eventId, eventName } of candidates) {
    if (options.dryRun) {
      skipped++
      continue
    }
    if (!(await claimWeeklySlot(application.id, cutoffIso))) {
      skipped++
      continue
    }

    const { count: ticketCount } = await supabase
      .from("ticket_types")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)

    const checklist = [{ label: "Ticket types configured", done: (ticketCount ?? 0) > 0 }]

    const typeLabel = getEventTypeConfig(application.application_type_id)?.label ?? application.application_type_id
    try {
      await sendOrganiserSetupStatusEmail(application, typeLabel, eventName, checklist)
      sent++
    } catch (err) {
      console.error(`[mou-organiser-reminders] weekly setup-status send failed for ${application.id}:`, err)
      skipped++
    }
  }

  return { sent, skipped }
}

export interface EventReminderResult {
  sent: number
  skipped: number
}

async function claim3DaySlot(applicationId: string): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("academic_event_applications")
    .update({ event_reminder_3day_sent_at: new Date().toISOString() })
    .eq("id", applicationId)
    .is("event_reminder_3day_sent_at", null)
    .select("id")
    .maybeSingle()
  return !!data
}

export async function run3DayEventReminders(options: { dryRun?: boolean } = {}): Promise<EventReminderResult> {
  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() + EVENT_REMINDER_DAYS_AHEAD * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const candidates = (await findOpenEventApplications()).filter(
    (c) => c.eventStartDate !== null && c.eventStartDate <= cutoff && !c.application.event_reminder_3day_sent_at
  )

  let sent = 0
  let skipped = 0

  for (const { application, eventId, eventName, eventStartDate } of candidates) {
    if (options.dryRun) {
      skipped++
      continue
    }
    if (!(await claim3DaySlot(application.id))) {
      skipped++
      continue
    }

    const { count: registeredCount } = await supabase
      .from("registrations")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("status", "confirmed")

    const typeLabel = getEventTypeConfig(application.application_type_id)?.label ?? application.application_type_id
    try {
      await sendOrganiserEventReminderEmail(application, typeLabel, eventName, eventStartDate, registeredCount ?? 0)
      sent++
    } catch (err) {
      console.error(`[mou-organiser-reminders] 3-day reminder send failed for ${application.id}:`, err)
      skipped++
    }
  }

  return { sent, skipped }
}

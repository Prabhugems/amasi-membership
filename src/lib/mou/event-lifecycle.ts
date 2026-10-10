import type { AcademicEventApplication } from "@/lib/mou/types"

// Pure date logic for "has this MOU event finished?". All calendar-day math
// is done in IST (Asia/Kolkata, fixed UTC+05:30, no DST) because every event
// date in this system is a plain calendar date entered by an Indian
// organiser: an event on 25 Sept is over at 26 Sept 00:00 IST, i.e. 25 Sept
// 18:30 UTC — not at 25 Sept 00:00 UTC and not "whenever the cron runs".

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/

type DateFields = Pick<AcademicEventApplication, "finalized_date" | "preferred_date_1">

// First 10 chars of an ISO date/timestamp if (and only if) it is a real
// calendar date; null otherwise (garbage strings never "complete" anything).
function validDay(value: string | null | undefined): string | null {
  if (!value) return null
  const m = DATE_RE.exec(value)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  return m[0]
}

function dayToUtcMs(day: string): number {
  const [y, mo, d] = day.split("-").map(Number)
  return Date.UTC(y, mo - 1, d)
}

/** Today's calendar date in IST as YYYY-MM-DD. */
export function todayIST(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** The IST calendar date (YYYY-MM-DD) of an instant, or null if unparseable. */
export function istDateOf(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null
  const t = new Date(timestamp).getTime()
  if (Number.isNaN(t)) return null
  return todayIST(new Date(t))
}

/**
 * The last calendar day of the event. The schema has no end-date column on
 * academic_event_applications, so: finalized_date, falling back to
 * preferred_date_1 (same fallback decide/route.ts and mou-report-reminders
 * use), treated as the last day. If the application has a linked events row
 * whose end_date is later (multi-day courses), that wins, so a 3-day course
 * is not completed after day 1.
 */
export function eventLastDay(app: DateFields, linkedEventEndDate?: string | null): string | null {
  const appDay = validDay(app.finalized_date) ?? validDay(app.preferred_date_1)
  if (!appDay) return null
  const eventEnd = validDay(linkedEventEndDate)
  return eventEnd && eventEnd > appDay ? eventEnd : appDay
}

/** The instant the event has ended: 00:00 IST on the day after its last day. null when no usable date. */
export function eventEndedAt(app: DateFields, linkedEventEndDate?: string | null): Date | null {
  const last = eventLastDay(app, linkedEventEndDate)
  if (!last) return null
  return new Date(dayToUtcMs(last) + DAY_MS - IST_OFFSET_MS)
}

/** True only for an `approved` application whose event has ended at `now`. Every other status never auto-completes. */
export function shouldAutoComplete(
  app: DateFields & Pick<AcademicEventApplication, "status">,
  now: Date,
  linkedEventEndDate?: string | null
): boolean {
  if (app.status !== "approved") return false
  const endedAt = eventEndedAt(app, linkedEventEndDate)
  return endedAt !== null && now.getTime() >= endedAt.getTime()
}

/**
 * Whole IST calendar days from the event's last day to today
 * (25 Sept event, on 27 Sept => 2). null when there is no usable date.
 * Zero or negative means the event is today or still ahead.
 */
export function daysSinceEventIST(app: DateFields, now: Date, linkedEventEndDate?: string | null): number | null {
  const last = eventLastDay(app, linkedEventEndDate)
  if (!last) return null
  return Math.round((dayToUtcMs(todayIST(now)) - dayToUtcMs(last)) / DAY_MS)
}

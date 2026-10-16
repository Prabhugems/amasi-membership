import type { AcademicEventApplication } from "./types"

// Pure helpers for the MOU admin calendar. Kept free of React / Supabase so
// they can be unit-tested directly (see __tests__/mou-calendar.test.ts).

export const CALENDAR_CATEGORIES = ["endorsed", "conference", "workshop", "camp", "other"] as const
export type CalendarCategory = (typeof CALENDAR_CATEGORIES)[number]

export const CALENDAR_CATEGORY_LABELS: Record<CalendarCategory, string> = {
  endorsed: "Endorsed event",
  conference: "Conference",
  workshop: "Workshop / CME",
  camp: "Camp / drive",
  other: "Other",
}

// Same five values as academic_event_applications.zone.
export const ZONES = ["North", "South", "East", "West", "Central"] as const
export type Zone = (typeof ZONES)[number]

export function isZone(value: unknown): value is Zone {
  return typeof value === "string" && (ZONES as readonly string[]).includes(value)
}

// Row shape of `mou_calendar_entries` (sql/058, zone added in sql/059).
export interface CalendarEntry {
  id: string
  title: string
  start_date: string
  end_date: string | null
  organizer: string | null
  city: string | null
  state: string | null
  zone: Zone | null
  category: CalendarCategory
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CalendarEntryInput {
  title: string
  start_date: string
  end_date: string | null
  organizer: string | null
  city: string | null
  state: string | null
  zone: Zone | null
  category: CalendarCategory
  notes: string | null
}

// One item on the calendar grid, regardless of where it came from.
export interface CalendarItem {
  key: string
  source: "mou" | "endorsed"
  id: string
  title: string
  startDate: string // YYYY-MM-DD
  endDate: string // YYYY-MM-DD, >= startDate
  subtitle: string | null
  // Application type id for MOU items, entry category for endorsed ones.
  kind: string
  zone: Zone | null
  // Cancelled MOU applications stay on the calendar (greyed) but never clash.
  cancelled: boolean
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

export type ParseResult = { ok: true; value: CalendarEntryInput } | { ok: false; message: string }

// Validates an untrusted request body into a CalendarEntryInput. Used by both
// POST and PATCH so the two can't drift.
export function parseCalendarEntryInput(body: unknown): ParseResult {
  if (!body || typeof body !== "object") return { ok: false, message: "Invalid request body" }
  const b = body as Record<string, unknown>

  const title = cleanText(b.title, 200)
  if (!title) return { ok: false, message: "Title is required" }

  if (!isIsoDate(b.start_date)) return { ok: false, message: "Start date must be a valid date (YYYY-MM-DD)" }
  const startDate = b.start_date

  let endDate: string | null = null
  if (b.end_date !== undefined && b.end_date !== null && b.end_date !== "") {
    if (!isIsoDate(b.end_date)) return { ok: false, message: "End date must be a valid date (YYYY-MM-DD)" }
    if (b.end_date < startDate) return { ok: false, message: "End date cannot be before the start date" }
    endDate = b.end_date
  }

  let zone: Zone | null = null
  if (b.zone !== undefined && b.zone !== null && b.zone !== "") {
    if (!isZone(b.zone)) return { ok: false, message: "Unknown zone" }
    zone = b.zone
  }

  const category = (b.category ?? "endorsed") as CalendarCategory
  if (!CALENDAR_CATEGORIES.includes(category)) return { ok: false, message: "Unknown category" }

  return {
    ok: true,
    value: {
      title,
      start_date: startDate,
      end_date: endDate,
      organizer: cleanText(b.organizer, 200),
      city: cleanText(b.city, 100),
      state: cleanText(b.state, 100),
      zone,
      category,
      notes: cleanText(b.notes, 2000),
    },
  }
}

// An application's calendar date: the confirmed date if there is one,
// otherwise the first requested date. Same rule as the table view.
export function applicationDate(app: Pick<AcademicEventApplication, "finalized_date" | "preferred_date_1">): string | null {
  return app.finalized_date || app.preferred_date_1 || null
}

export function applicationToItem(app: AcademicEventApplication): CalendarItem | null {
  const date = applicationDate(app)
  if (!date || !isIsoDate(date)) return null
  const place = [app.venue_city, app.venue_state].filter(Boolean).join(", ")
  return {
    key: `mou:${app.id}`,
    source: "mou",
    id: app.id,
    title: app.event_name?.trim() || app.primary_institution || app.organizer_name,
    startDate: date,
    endDate: date,
    subtitle: [app.organizer_name, place].filter(Boolean).join(" · ") || null,
    kind: app.application_type_id,
    zone: isZone(app.zone) ? app.zone : null,
    cancelled: app.status === "cancelled",
  }
}

export function entryToItem(entry: CalendarEntry): CalendarItem {
  const place = [entry.city, entry.state].filter(Boolean).join(", ")
  return {
    key: `entry:${entry.id}`,
    source: "endorsed",
    id: entry.id,
    title: entry.title,
    startDate: entry.start_date,
    endDate: entry.end_date && entry.end_date >= entry.start_date ? entry.end_date : entry.start_date,
    subtitle: [entry.organizer, place].filter(Boolean).join(" · ") || null,
    kind: entry.category,
    zone: isZone(entry.zone) ? entry.zone : null,
    cancelled: false,
  }
}

// Merges both sources into one list sorted by start date, then title.
export function buildCalendarItems(apps: AcademicEventApplication[], entries: CalendarEntry[]): CalendarItem[] {
  const items: CalendarItem[] = []
  for (const app of apps) {
    const item = applicationToItem(app)
    if (item) items.push(item)
  }
  for (const entry of entries) items.push(entryToItem(entry))
  return items.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title))
}

export function toIsoDate(year: number, monthIndex: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

// Items that touch the given day (multi-day entries appear on every day).
export function itemsOnDay(items: CalendarItem[], isoDate: string): CalendarItem[] {
  return items.filter((i) => i.startDate <= isoDate && isoDate <= i.endDate)
}

// Grid cells for a month, Monday-first: leading/trailing nulls pad whole weeks.
export function monthGrid(year: number, monthIndex: number): (string | null)[] {
  const first = new Date(Date.UTC(year, monthIndex, 1))
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 6) % 7
  const cells: (string | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(toIsoDate(year, monthIndex, d))
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

// First and last day of a month as ISO strings, for range queries.
export function monthRange(year: number, monthIndex: number): { from: string; to: string } {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  return { from: toIsoDate(year, monthIndex, 1), to: toIsoDate(year, monthIndex, last) }
}

export function datesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

// Two events clash when they share a zone and their dates overlap. Items with
// no zone can't be compared, and cancelled items never clash (a cancelled
// event is exactly what frees the date up).
export function itemsClash(a: CalendarItem, b: CalendarItem): boolean {
  if (a.key === b.key || a.cancelled || b.cancelled) return false
  if (!a.zone || !b.zone || a.zone !== b.zone) return false
  return datesOverlap(a.startDate, a.endDate, b.startDate, b.endDate)
}

// For every item that clashes with at least one other, the items it clashes with.
export function findClashes(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const out = new Map<string, CalendarItem[]>()
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (!itemsClash(items[i], items[j])) continue
      out.set(items[i].key, [...(out.get(items[i].key) ?? []), items[j]])
      out.set(items[j].key, [...(out.get(items[j].key) ?? []), items[i]])
    }
  }
  return out
}

// Items from `candidates` that clash with a single target event (used when
// reviewing one application, where the target isn't on the calendar yet).
export function clashesForTarget(target: CalendarItem, candidates: CalendarItem[]): CalendarItem[] {
  return candidates.filter((c) => itemsClash(target, c))
}

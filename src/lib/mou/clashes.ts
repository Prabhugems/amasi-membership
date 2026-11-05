import { createAdminClient } from "@/lib/supabase"
import {
  applicationToItem,
  clashesForTarget,
  entryToItem,
  type CalendarEntry,
  type CalendarItem,
} from "./calendar"
import type { AcademicEventApplication } from "./types"

// Server-side "does this event clash with anything else?" check, used on the
// admin detail view and the Secretary's review page. A clash = same zone +
// overlapping dates against other approved/completed MOU events and admin-
// added endorsed events; cancelled events never count (see itemsClash).

const APPLICATION_COLUMNS =
  "id, application_type_id, status, organizer_name, primary_institution, event_name, finalized_date, preferred_date_1, venue_city, venue_state, zone"

export async function getClashesForApplication(app: AcademicEventApplication): Promise<CalendarItem[]> {
  const target = applicationToItem(app)
  // Nothing to compare without a date and a zone; a cancelled event holds no date.
  if (!target || !target.zone || target.cancelled) return []

  const supabase = createAdminClient()
  const [appsRes, entriesRes] = await Promise.all([
    supabase
      .from("academic_event_applications")
      .select(APPLICATION_COLUMNS)
      .eq("zone", target.zone)
      .in("status", ["approved", "completed"])
      .neq("id", app.id)
      .limit(500),
    supabase
      .from("mou_calendar_entries")
      .select("*")
      .eq("zone", target.zone)
      .lte("start_date", target.endDate)
      .limit(500),
  ])

  // A failed lookup must not block approving or viewing — but it must not
  // pass silently as "no clashes" either.
  if (appsRes.error) console.error("[mou-clashes] applications lookup failed:", appsRes.error.message)
  if (entriesRes.error) console.error("[mou-clashes] endorsed events lookup failed:", entriesRes.error.message)

  const candidates: CalendarItem[] = []
  for (const row of (appsRes.data ?? []) as unknown as AcademicEventApplication[]) {
    const item = applicationToItem(row)
    if (item) candidates.push(item)
  }
  for (const entry of (entriesRes.data ?? []) as CalendarEntry[]) candidates.push(entryToItem(entry))

  return clashesForTarget(target, candidates)
}

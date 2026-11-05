import { describe, it, expect } from "vitest"
import {
  applicationToItem,
  buildCalendarItems,
  clashesForTarget,
  entryToItem,
  findClashes,
  itemsClash,
  isIsoDate,
  itemsOnDay,
  monthGrid,
  monthRange,
  parseCalendarEntryInput,
  type CalendarEntry,
} from "@/lib/mou/calendar"
import type { AcademicEventApplication } from "@/lib/mou/types"

function app(overrides: Partial<AcademicEventApplication>): AcademicEventApplication {
  return {
    id: "app-1",
    application_type_id: "workshop",
    status: "approved",
    organizer_name: "Dr Organiser",
    primary_institution: "Some Hospital",
    event_name: "Lap Workshop",
    preferred_date_1: "2026-11-10",
    finalized_date: null,
    venue_city: "Pune",
    venue_state: "Maharashtra",
    ...overrides,
  } as AcademicEventApplication
}

function entry(overrides: Partial<CalendarEntry>): CalendarEntry {
  return {
    id: "e-1",
    title: "State Chapter Conference",
    start_date: "2026-11-05",
    end_date: null,
    organizer: null,
    city: null,
    state: null,
    zone: null,
    category: "endorsed",
    notes: null,
    created_by: null,
    created_at: "2026-10-16T00:00:00Z",
    updated_at: "2026-10-16T00:00:00Z",
    ...overrides,
  }
}

describe("isIsoDate", () => {
  it("accepts real dates and rejects malformed or impossible ones", () => {
    expect(isIsoDate("2026-10-16")).toBe(true)
    expect(isIsoDate("2028-02-29")).toBe(true)
    expect(isIsoDate("2026-02-30")).toBe(false)
    expect(isIsoDate("2026-13-01")).toBe(false)
    expect(isIsoDate("16-10-2026")).toBe(false)
    expect(isIsoDate(null)).toBe(false)
  })
})

describe("parseCalendarEntryInput", () => {
  it("accepts a minimal valid body and defaults the category", () => {
    const r = parseCalendarEntryInput({ title: "  Camp  ", start_date: "2026-12-01" })
    expect(r).toEqual({
      ok: true,
      value: {
        title: "Camp",
        start_date: "2026-12-01",
        end_date: null,
        organizer: null,
        city: null,
        state: null,
        zone: null,
        category: "endorsed",
        notes: null,
      },
    })
  })

  it("treats an empty end date as no end date", () => {
    const r = parseCalendarEntryInput({ title: "X", start_date: "2026-12-01", end_date: "" })
    expect(r.ok && r.value.end_date).toBeNull()
  })

  it("rejects a missing or blank title", () => {
    expect(parseCalendarEntryInput({ start_date: "2026-12-01" }).ok).toBe(false)
    expect(parseCalendarEntryInput({ title: "   ", start_date: "2026-12-01" }).ok).toBe(false)
  })

  it("rejects bad dates and an end before the start", () => {
    expect(parseCalendarEntryInput({ title: "X", start_date: "soon" }).ok).toBe(false)
    expect(parseCalendarEntryInput({ title: "X", start_date: "2026-12-05", end_date: "2026-12-01" }).ok).toBe(false)
    expect(parseCalendarEntryInput({ title: "X", start_date: "2026-12-05", end_date: "nope" }).ok).toBe(false)
  })

  it("rejects an unknown category and non-object bodies", () => {
    expect(parseCalendarEntryInput({ title: "X", start_date: "2026-12-01", category: "party" }).ok).toBe(false)
    expect(parseCalendarEntryInput(null).ok).toBe(false)
    expect(parseCalendarEntryInput("x").ok).toBe(false)
  })
})

describe("calendar items", () => {
  it("uses the confirmed date over the requested date for applications", () => {
    const item = applicationToItem(app({ finalized_date: "2026-11-12" }))
    expect(item?.startDate).toBe("2026-11-12")
    expect(item?.source).toBe("mou")
    expect(item?.subtitle).toBe("Dr Organiser · Pune, Maharashtra")
  })

  it("falls back to the requested date and skips applications with no usable date", () => {
    expect(applicationToItem(app({}))?.startDate).toBe("2026-11-10")
    expect(applicationToItem(app({ preferred_date_1: "" as string, finalized_date: null }))).toBeNull()
  })

  it("names an application after its event, then institution", () => {
    expect(applicationToItem(app({ event_name: null }))?.title).toBe("Some Hospital")
  })

  it("makes a single-day item when an endorsed entry has no end date", () => {
    const item = entryToItem(entry({}))
    expect(item.startDate).toBe("2026-11-05")
    expect(item.endDate).toBe("2026-11-05")
    expect(item.source).toBe("endorsed")
  })

  it("merges both sources sorted by date", () => {
    const items = buildCalendarItems(
      [app({ id: "a", preferred_date_1: "2026-11-20" }), app({ id: "b", preferred_date_1: "2026-11-01" })],
      [entry({ id: "c", start_date: "2026-11-10" })]
    )
    expect(items.map((i) => i.key)).toEqual(["mou:b", "entry:c", "mou:a"])
  })
})

describe("itemsOnDay", () => {
  it("shows a multi-day entry on every day it spans, inclusive", () => {
    const items = buildCalendarItems([], [entry({ start_date: "2026-11-05", end_date: "2026-11-07" })])
    expect(itemsOnDay(items, "2026-11-04")).toHaveLength(0)
    expect(itemsOnDay(items, "2026-11-05")).toHaveLength(1)
    expect(itemsOnDay(items, "2026-11-06")).toHaveLength(1)
    expect(itemsOnDay(items, "2026-11-07")).toHaveLength(1)
    expect(itemsOnDay(items, "2026-11-08")).toHaveLength(0)
  })
})

describe("monthGrid / monthRange", () => {
  it("builds whole Monday-first weeks (Oct 2026 starts on a Thursday)", () => {
    const cells = monthGrid(2026, 9)
    expect(cells.length % 7).toBe(0)
    expect(cells.slice(0, 3)).toEqual([null, null, null])
    expect(cells[3]).toBe("2026-10-01")
    expect(cells.filter(Boolean)).toHaveLength(31)
  })

  it("handles a month that starts on Monday with no leading padding (Jun 2026)", () => {
    expect(monthGrid(2026, 5)[0]).toBe("2026-06-01")
  })

  it("returns the first and last day, including leap February", () => {
    expect(monthRange(2026, 10)).toEqual({ from: "2026-11-01", to: "2026-11-30" })
    expect(monthRange(2028, 1)).toEqual({ from: "2028-02-01", to: "2028-02-29" })
  })
})

describe("zone", () => {
  it("accepts a valid zone, treats blank as none, rejects unknown", () => {
    const ok = parseCalendarEntryInput({ title: "X", start_date: "2026-12-01", zone: "East" })
    expect(ok.ok && ok.value.zone).toBe("East")
    const blank = parseCalendarEntryInput({ title: "X", start_date: "2026-12-01", zone: "" })
    expect(blank.ok && blank.value.zone).toBeNull()
    expect(parseCalendarEntryInput({ title: "X", start_date: "2026-12-01", zone: "Mars" }).ok).toBe(false)
  })

  it("carries the zone and cancelled flag onto calendar items", () => {
    const a = applicationToItem(app({ zone: "South", status: "cancelled" } as Partial<AcademicEventApplication>))
    expect(a?.zone).toBe("South")
    expect(a?.cancelled).toBe(true)
    expect(entryToItem(entry({ zone: "West" })).zone).toBe("West")
    expect(applicationToItem(app({ zone: null }))?.zone).toBeNull()
  })
})

describe("clashes", () => {
  const item = (o: Partial<AcademicEventApplication> & { id: string }) => {
    const i = applicationToItem(app({ zone: "East", ...o }))
    if (!i) throw new Error("fixture has no date")
    return i
  }

  it("flags same-zone events whose dates overlap, including multi-day endorsed events", () => {
    const a = item({ id: "a", preferred_date_1: "2026-11-21" })
    const b = entryToItem(entry({ id: "b", zone: "East", start_date: "2026-11-20", end_date: "2026-11-22" }))
    expect(itemsClash(a, b)).toBe(true)
    const map = findClashes([a, b])
    expect(map.get(a.key)?.map((x) => x.key)).toEqual([b.key])
    expect(map.get(b.key)?.map((x) => x.key)).toEqual([a.key])
  })

  it("does not flag different zones, different dates, or events with no zone", () => {
    const a = item({ id: "a", preferred_date_1: "2026-11-21" })
    expect(itemsClash(a, item({ id: "b", preferred_date_1: "2026-11-21", zone: "West" }))).toBe(false)
    expect(itemsClash(a, item({ id: "c", preferred_date_1: "2026-11-23" }))).toBe(false)
    expect(itemsClash(a, item({ id: "d", preferred_date_1: "2026-11-21", zone: null }))).toBe(false)
    expect(itemsClash(a, a)).toBe(false)
  })

  it("never counts a cancelled event as a clash — it frees the date", () => {
    const live = item({ id: "a", preferred_date_1: "2026-11-21" })
    const cancelled = item({ id: "b", preferred_date_1: "2026-11-21", status: "cancelled" })
    expect(itemsClash(live, cancelled)).toBe(false)
    expect(findClashes([live, cancelled]).size).toBe(0)
  })

  it("clashesForTarget returns only the candidates that clash with one event", () => {
    const target = item({ id: "t", preferred_date_1: "2026-11-21" })
    const hit = item({ id: "h", preferred_date_1: "2026-11-21" })
    const miss = item({ id: "m", preferred_date_1: "2026-12-21" })
    expect(clashesForTarget(target, [hit, miss]).map((x) => x.id)).toEqual(["h"])
  })
})

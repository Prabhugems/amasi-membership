import { describe, it, expect } from "vitest"
import {
  applicationToItem,
  buildCalendarItems,
  entryToItem,
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

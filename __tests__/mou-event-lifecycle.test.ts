import { describe, it, expect } from "vitest"
import {
  daysSinceEventIST,
  eventEndedAt,
  eventLastDay,
  shouldAutoComplete,
  todayIST,
} from "@/lib/mou/event-lifecycle"

const app = (o: Record<string, unknown> = {}) => ({
  status: "approved" as const,
  finalized_date: null as string | null,
  preferred_date_1: "2026-09-25",
  ...o,
})

describe("eventLastDay / eventEndedAt", () => {
  it("prefers finalized_date, falls back to preferred_date_1", () => {
    expect(eventLastDay(app({ finalized_date: "2026-09-27" }))).toBe("2026-09-27")
    expect(eventLastDay(app())).toBe("2026-09-25")
  })

  it("uses a later linked event end_date (multi-day course) but never an earlier one", () => {
    expect(eventLastDay(app({ finalized_date: "2026-09-25" }), "2026-09-27")).toBe("2026-09-27")
    expect(eventLastDay(app({ finalized_date: "2026-09-25" }), "2026-09-20")).toBe("2026-09-25")
    expect(eventLastDay(app(), null)).toBe("2026-09-25")
  })

  it("event on 25 Sept ends at 26 Sept 00:00 IST (= 25 Sept 18:30 UTC)", () => {
    expect(eventEndedAt(app())!.toISOString()).toBe("2026-09-25T18:30:00.000Z")
  })

  it("returns null for missing or malformed dates", () => {
    expect(eventEndedAt(app({ preferred_date_1: null }))).toBeNull()
    expect(eventEndedAt(app({ preferred_date_1: "" }))).toBeNull()
    expect(eventEndedAt(app({ preferred_date_1: "not-a-date" }))).toBeNull()
    expect(eventEndedAt(app({ preferred_date_1: "2026-02-31" }))).toBeNull()
  })
})

describe("shouldAutoComplete — IST boundary", () => {
  it("does NOT complete on the event day, even late in the evening IST", () => {
    // 25 Sept 23:59 IST = 25 Sept 18:29 UTC
    expect(shouldAutoComplete(app(), new Date("2026-09-25T18:29:59.999Z"))).toBe(false)
    expect(shouldAutoComplete(app(), new Date("2026-09-25T12:00:00Z"))).toBe(false)
  })

  it("completes at exactly 26 Sept 00:00 IST", () => {
    expect(shouldAutoComplete(app(), new Date("2026-09-25T18:30:00.000Z"))).toBe(true)
    expect(shouldAutoComplete(app(), new Date("2026-10-10T00:00:00Z"))).toBe(true)
  })

  it("a cron at 04:05 UTC on 26 Sept (09:35 IST) completes a 25 Sept event; 25 Sept 04:05 UTC does not", () => {
    expect(shouldAutoComplete(app(), new Date("2026-09-26T04:05:00Z"))).toBe(true)
    expect(shouldAutoComplete(app(), new Date("2026-09-25T04:05:00Z"))).toBe(false)
  })

  it("never completes when the date is missing", () => {
    expect(shouldAutoComplete(app({ preferred_date_1: null }), new Date("2030-01-01T00:00:00Z"))).toBe(false)
  })

  it.each(["submitted", "under_review", "changes_requested", "rejected", "completed"])(
    "never completes a %s application",
    (status) => {
      expect(shouldAutoComplete(app({ status }), new Date("2030-01-01T00:00:00Z"))).toBe(false)
    }
  )

  it("holds a multi-day course until its linked event end_date has passed", () => {
    const a = app({ finalized_date: "2026-09-25" })
    expect(shouldAutoComplete(a, new Date("2026-09-26T04:05:00Z"), "2026-09-27")).toBe(false)
    expect(shouldAutoComplete(a, new Date("2026-09-28T04:05:00Z"), "2026-09-27")).toBe(true)
  })
})

describe("todayIST / daysSinceEventIST", () => {
  it("todayIST rolls over at 18:30 UTC", () => {
    expect(todayIST(new Date("2026-10-10T18:29:00Z"))).toBe("2026-10-10")
    expect(todayIST(new Date("2026-10-10T18:30:00Z"))).toBe("2026-10-11")
  })

  it("counts whole IST calendar days since the last event day", () => {
    const a = app({ preferred_date_1: "2026-09-27" })
    expect(daysSinceEventIST(a, new Date("2026-10-10T05:00:00Z"))).toBe(13)
    expect(daysSinceEventIST(a, new Date("2026-09-27T20:00:00Z"))).toBe(1) // 28 Sept 01:30 IST
    expect(daysSinceEventIST(a, new Date("2026-09-27T10:00:00Z"))).toBe(0)
    expect(daysSinceEventIST(app({ preferred_date_1: null }), new Date())).toBeNull()
  })
})

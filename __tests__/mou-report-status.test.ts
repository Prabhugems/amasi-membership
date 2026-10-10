import { describe, it, expect } from "vitest"
import {
  getReportStatusView,
  isReportFilter,
  matchesReportFilter,
  reportStateCsvLabel,
  summarizeReports,
  REPORT_OVERDUE_AFTER_DAYS,
} from "@/lib/mou/report-status"

const NOW = new Date("2026-10-10T05:00:00Z") // 10 Oct 2026, 10:30 IST

const app = (o: Record<string, unknown> = {}) => ({
  status: "approved" as const,
  finalized_date: null as string | null,
  preferred_date_1: "2026-09-27",
  report_status: null as "submitted" | "accepted" | "returned" | null,
  report_submitted_at: null as string | null,
  ...o,
})

describe("getReportStatusView", () => {
  it("is null (dash) for a future event or one happening today", () => {
    expect(getReportStatusView(app({ preferred_date_1: "2026-10-18" }), NOW)).toBeNull()
    expect(getReportStatusView(app({ preferred_date_1: "2026-10-10" }), NOW)).toBeNull()
  })

  it("is null for statuses with no report obligation or missing dates", () => {
    for (const status of ["submitted", "under_review", "changes_requested", "rejected"]) {
      expect(getReportStatusView(app({ status }), NOW)).toBeNull()
    }
    expect(getReportStatusView(app({ preferred_date_1: null }), NOW)).toBeNull()
  })

  it("not submitted: counts days since the event in IST and warns after 7 days", () => {
    const v = getReportStatusView(app(), NOW)!
    expect(v).toMatchObject({ state: "not_submitted", daysSince: 13, overdue: true })
    expect(v.label).toBe("Not submitted (13 days since the event)")

    const recent = getReportStatusView(app({ preferred_date_1: "2026-10-09" }), NOW)!
    expect(recent.label).toBe("Not submitted (1 day since the event)")
    expect(recent.overdue).toBe(false)
  })

  it("overdue starts at the 8th day, not the 7th", () => {
    const d7 = getReportStatusView(app({ preferred_date_1: "2026-10-03" }), NOW)!
    const d8 = getReportStatusView(app({ preferred_date_1: "2026-10-02" }), NOW)!
    expect(REPORT_OVERDUE_AFTER_DAYS).toBe(7)
    expect(d7.overdue).toBe(false)
    expect(d8.overdue).toBe(true)
  })

  it("submitted: shows the IST submit date and needs review", () => {
    const v = getReportStatusView(
      app({ preferred_date_1: "2026-09-25", report_status: "submitted", report_submitted_at: "2026-10-02T09:00:00Z" }),
      NOW
    )!
    expect(v.state).toBe("submitted")
    expect(v.label).toBe("Submitted on 02 Oct 2026, needs review")
    expect(v.overdue).toBe(false)
  })

  it("submitted date uses the IST day (late-evening UTC rolls to next IST day)", () => {
    const v = getReportStatusView(
      app({ report_status: "submitted", report_submitted_at: "2026-10-02T20:00:00Z" }),
      NOW
    )!
    expect(v.label).toBe("Submitted on 03 Oct 2026, needs review")
  })

  it("a legacy submission with a timestamp but no report_status counts as submitted", () => {
    expect(getReportStatusView(app({ report_submitted_at: "2026-10-01T00:00:00Z" }), NOW)!.state).toBe("submitted")
  })

  it("returned and accepted", () => {
    expect(getReportStatusView(app({ report_status: "returned", report_submitted_at: "2026-10-01T00:00:00Z" }), NOW)!.label).toBe(
      "Returned, waiting for organiser"
    )
    const acc = getReportStatusView(app({ status: "completed", report_status: "accepted" }), NOW)!
    expect(acc).toMatchObject({ state: "accepted", label: "Accepted", overdue: false })
  })

  it("works the same for completed applications", () => {
    expect(getReportStatusView(app({ status: "completed" }), NOW)!.state).toBe("not_submitted")
  })
})

describe("filters, summary, csv label", () => {
  const apps = [
    app({ status: "completed", preferred_date_1: "2026-09-12", report_status: "accepted" }),
    app({ status: "completed", preferred_date_1: "2026-09-12", report_status: "accepted" }),
    app({ preferred_date_1: "2026-09-25", report_status: "submitted", report_submitted_at: "2026-10-02T09:00:00Z" }),
    app({ preferred_date_1: "2026-09-27" }),
    app({ preferred_date_1: "2026-09-27" }),
    app({ preferred_date_1: "2026-10-18" }),
    app({ status: "rejected", preferred_date_1: "2026-09-01" }),
  ]

  it("summarizeReports counts the prod-shaped example", () => {
    expect(summarizeReports(apps, NOW)).toEqual({
      awaitingReview: 1,
      overdue: 2,
      notSubmitted: 2,
      returned: 0,
      accepted: 2,
    })
  })

  it("matchesReportFilter", () => {
    const [accepted, , submitted, missing] = apps.map((a) => getReportStatusView(a, NOW))
    expect(matchesReportFilter(accepted, "accepted")).toBe(true)
    expect(matchesReportFilter(submitted, "submitted")).toBe(true)
    expect(matchesReportFilter(missing, "not_submitted")).toBe(true)
    expect(matchesReportFilter(missing, "overdue")).toBe(true)
    expect(matchesReportFilter(submitted, "overdue")).toBe(false)
    expect(matchesReportFilter(null, "accepted")).toBe(false)
  })

  it("isReportFilter validates", () => {
    expect(isReportFilter("overdue")).toBe(true)
    expect(isReportFilter("bogus")).toBe(false)
    expect(isReportFilter(null)).toBe(false)
  })

  it("csv label is blank for no-obligation rows, plain text otherwise", () => {
    expect(reportStateCsvLabel(null)).toBe("")
    expect(reportStateCsvLabel(getReportStatusView(apps[3], NOW))).toBe("not submitted")
    expect(reportStateCsvLabel(getReportStatusView(apps[2], NOW))).toBe("submitted (needs review)")
  })
})

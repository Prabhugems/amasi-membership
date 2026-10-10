import type { AcademicEventApplication } from "@/lib/mou/types"
import { daysSinceEventIST, eventEndedAt, istDateOf } from "@/lib/mou/event-lifecycle"

// The post-event report is tracked separately from application status
// (`report_status` + `report_submitted_at`). Since status flips to
// "completed" automatically when the event date passes, "completed" no
// longer implies the report is accepted — this module is the single place
// that turns (status, dates, report fields) into the admin-facing state.

/** Days after the event beyond which a missing report is flagged (warning + "overdue" counter). */
export const REPORT_OVERDUE_AFTER_DAYS = 7

export type ReportState = "not_submitted" | "submitted" | "returned" | "accepted"
export type ReportFilter = ReportState | "overdue"
export const REPORT_FILTERS: ReportFilter[] = ["not_submitted", "overdue", "submitted", "returned", "accepted"]

export function isReportFilter(value: string | null | undefined): value is ReportFilter {
  return !!value && (REPORT_FILTERS as string[]).includes(value)
}

export interface ReportStatusView {
  state: ReportState
  /** Full human label, e.g. "Not submitted (13 days since the event)". */
  label: string
  /** True when not submitted and more than REPORT_OVERDUE_AFTER_DAYS since the event. */
  overdue: boolean
  daysSince: number
}

export type ReportInput = Pick<
  AcademicEventApplication,
  "status" | "finalized_date" | "preferred_date_1" | "report_status" | "report_submitted_at"
>

function formatIstDay(day: string | null): string {
  if (!day) return "unknown date"
  const [y, m, d] = day.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/**
 * Report state for an application, or null when no report is expected yet:
 * only approved/completed applications carry a report obligation, and only
 * once the event has ended (a future or in-progress event shows a dash).
 */
export function getReportStatusView(app: ReportInput, now: Date = new Date()): ReportStatusView | null {
  if (app.status !== "approved" && app.status !== "completed") return null
  const endedAt = eventEndedAt(app)
  if (!endedAt || now.getTime() < endedAt.getTime()) return null
  const daysSince = daysSinceEventIST(app, now)
  if (daysSince === null) return null

  if (app.report_status === "accepted") {
    return { state: "accepted", label: "Accepted", overdue: false, daysSince }
  }
  if (app.report_status === "returned") {
    return { state: "returned", label: "Returned, waiting for organiser", overdue: false, daysSince }
  }
  // report_submitted_at without a report_status is a legacy submission that
  // predates the review flow: it is in, and needs review.
  if (app.report_status === "submitted" || app.report_submitted_at) {
    return {
      state: "submitted",
      label: `Submitted on ${formatIstDay(istDateOf(app.report_submitted_at))}, needs review`,
      overdue: false,
      daysSince,
    }
  }
  const overdue = daysSince > REPORT_OVERDUE_AFTER_DAYS
  return {
    state: "not_submitted",
    label: `Not submitted (${daysSince} ${daysSince === 1 ? "day" : "days"} since the event)`,
    overdue,
    daysSince,
  }
}

export function matchesReportFilter(view: ReportStatusView | null, filter: ReportFilter): boolean {
  if (!view) return false
  return filter === "overdue" ? view.overdue : view.state === filter
}

export interface ReportSummary {
  awaitingReview: number
  overdue: number
  notSubmitted: number
  returned: number
  accepted: number
}

export function summarizeReports(apps: ReportInput[], now: Date = new Date()): ReportSummary {
  const s: ReportSummary = { awaitingReview: 0, overdue: 0, notSubmitted: 0, returned: 0, accepted: 0 }
  for (const app of apps) {
    const v = getReportStatusView(app, now)
    if (!v) continue
    if (v.state === "submitted") s.awaitingReview++
    else if (v.state === "returned") s.returned++
    else if (v.state === "accepted") s.accepted++
    else {
      s.notSubmitted++
      if (v.overdue) s.overdue++
    }
  }
  return s
}

/** Plain-text state for the CSV (the day-count label stays UI-only). */
export function reportStateCsvLabel(view: ReportStatusView | null): string {
  if (!view) return ""
  return {
    not_submitted: "not submitted",
    submitted: "submitted (needs review)",
    returned: "returned",
    accepted: "accepted",
  }[view.state]
}

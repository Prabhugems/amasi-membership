import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createMockSupabase } from "./mou-supabase-mock"

const { mockClient } = vi.hoisted(() => ({
  mockClient: { current: null as ReturnType<typeof import("./mou-supabase-mock").createMockSupabase> | null },
}))
vi.mock("@/lib/supabase", () => ({ createAdminClient: () => mockClient.current }))

import { listApplications, getReportSummary } from "@/lib/mou/supabase-helpers"

const base = {
  finalized_date: null,
  report_status: null,
  report_submitted_at: null,
  created_at: "2026-08-01T00:00:00Z",
}

describe("listApplications — approved+completed view and report filter", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-10T05:00:00Z"))
    mockClient.current = createMockSupabase({
      academic_event_applications: [
        { ...base, id: "done", status: "completed", preferred_date_1: "2026-09-12", report_status: "accepted" },
        { ...base, id: "await", status: "approved", preferred_date_1: "2026-09-25", report_status: "submitted", report_submitted_at: "2026-10-02T09:00:00Z" },
        { ...base, id: "missing", status: "approved", preferred_date_1: "2026-09-27" },
        { ...base, id: "future", status: "approved", preferred_date_1: "2026-10-18" },
        { ...base, id: "rej", status: "rejected", preferred_date_1: "2026-09-01" },
      ],
    })
  })
  afterEach(() => vi.useRealTimers())

  it("status accepts a comma list so completed events stay in the 'approved' view", async () => {
    const { rows } = await listApplications({ status: "approved,completed" })
    expect(rows.map((r) => r.id).sort()).toEqual(["await", "done", "future", "missing"])
  })

  it("a single status still works", async () => {
    const { rows } = await listApplications({ status: "rejected" })
    expect(rows.map((r) => r.id)).toEqual(["rej"])
  })

  it("filters by report state on the server, with a correct total", async () => {
    expect((await listApplications({ report: "submitted" })).rows.map((r) => r.id)).toEqual(["await"])
    expect((await listApplications({ report: "overdue" })).rows.map((r) => r.id)).toEqual(["missing"])
    const accepted = await listApplications({ report: "accepted" })
    expect(accepted).toMatchObject({ total: 1 })
  })

  it("getReportSummary counts only approved/completed events that have ended", async () => {
    expect(await getReportSummary()).toEqual({ awaitingReview: 1, overdue: 1, notSubmitted: 1, returned: 0, accepted: 1 })
  })
})

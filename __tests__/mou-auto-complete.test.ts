import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createMockSupabase } from "./mou-supabase-mock"

const { mockClient, getAdminSessionMock, notifyMocks, heartbeatMock } = vi.hoisted(() => ({
  heartbeatMock: vi.fn(),
  mockClient: { current: null as ReturnType<typeof import("./mou-supabase-mock").createMockSupabase> | null },
  getAdminSessionMock: vi.fn(),
  notifyMocks: {
    sendOutcomeEmail: vi.fn(),
    sendReportReminderEmail: vi.fn(),
    sendReportEscalationEmail: vi.fn(),
    sendReportReturnedEmail: vi.fn(),
  },
}))
vi.mock("@/lib/supabase", () => ({ createAdminClient: () => mockClient.current }))
vi.mock("@/lib/cron-heartbeat", () => ({ recordHeartbeat: heartbeatMock }))
vi.mock("@/lib/auth", () => ({ getAdminSession: getAdminSessionMock }))
// Any email helper being called on this transition would be a regression.
vi.mock("@/lib/mou/notify", () => notifyMocks)

import { GET } from "@/app/api/cron/mou-auto-complete/route"
import { MOU_AUTO_COMPLETE_MAX_PER_RUN } from "@/lib/mou-auto-complete"

const NOW = new Date("2026-10-10T04:05:00Z") // 09:35 IST on 10 Oct 2026

function row(o: Record<string, unknown> = {}) {
  return {
    id: "app-1",
    application_type_id: "nextgen",
    status: "approved",
    finalized_date: null,
    preferred_date_1: "2026-09-27",
    created_event_id: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    report_status: null,
    ...o,
  }
}

const req = (headers: Record<string, string> = {}, qs = "") =>
  new Request(`https://test.local/api/cron/mou-auto-complete${qs}`, { headers })
const authed = { authorization: "Bearer s3cret" }

describe("GET /api/cron/mou-auto-complete", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    process.env.CRON_SECRET = "s3cret"
    getAdminSessionMock.mockResolvedValue(null)
    mockClient.current = createMockSupabase({ academic_event_applications: [row()], events: [], admin_audit_log: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
    delete process.env.CRON_SECRET
  })

  const apps = () => mockClient.current!._tables.get("academic_event_applications")!
  const audit = () => mockClient.current!._tables.get("admin_audit_log")!

  it("401s without the secret and changes nothing", async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    const wrong = await GET(req({ authorization: "Bearer nope" }))
    expect(wrong.status).toBe(401)
    expect(apps()[0].status).toBe("approved")
  })

  it("fails closed when CRON_SECRET is unset, even for an empty/undefined bearer", async () => {
    delete process.env.CRON_SECRET
    expect((await GET(req({ authorization: "Bearer undefined" }))).status).toBe(401)
    expect((await GET(req({ authorization: "Bearer " }))).status).toBe(401)
    expect(apps()[0].status).toBe("approved")
  })

  it("a non-super-admin session is not enough", async () => {
    getAdminSessionMock.mockResolvedValue({ adminRole: "admin" })
    expect((await GET(req())).status).toBe(401)
    getAdminSessionMock.mockResolvedValue({ adminRole: "super_admin" })
    expect((await GET(req())).status).toBe(200)
  })

  it("completes an approved application whose event has ended, writes updated_at and an audit row", async () => {
    const res = await GET(req(authed))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ completed: 1, skipped: 0, deferred: 0, dryRun: false, completedIds: ["app-1"] })
    expect(heartbeatMock).toHaveBeenCalledWith("mou-auto-complete", { success: true })
    expect(apps()[0].status).toBe("completed")
    expect(apps()[0].updated_at).toBe(NOW.toISOString())
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({
      admin_email: "system:mou-auto-complete",
      action: "mou_auto_completed",
      entity_type: "academic_event_application",
      entity_id: "app-1",
    })
    expect(audit()[0].details).toMatchObject({
      changes: { status: { from: "approved", to: "completed" } },
      eventDateUsed: "2026-09-27",
      dateSource: "preferred_date_1",
    })
  })

  it("sends no emails or notifications and leaves report fields alone", async () => {
    mockClient.current!._setTable("academic_event_applications", [row({ report_status: "submitted" })])
    await GET(req(authed))
    for (const fn of Object.values(notifyMocks)) expect(fn).not.toHaveBeenCalled()
    expect(apps()[0].report_status).toBe("submitted")
  })

  it("does not complete the event-day itself (IST boundary) or future events", async () => {
    mockClient.current!._setTable("academic_event_applications", [
      row({ id: "yesterday", preferred_date_1: "2026-10-09" }),
      row({ id: "today", preferred_date_1: "2026-10-10" }),
      row({ id: "future", preferred_date_1: "2026-10-18" }),
    ])
    const body = await (await GET(req(authed))).json()
    expect(body.completedIds).toEqual(["yesterday"])
    expect(apps().find((a) => a.id === "today")!.status).toBe("approved")
    expect(apps().find((a) => a.id === "future")!.status).toBe("approved")
  })

  it("uses finalized_date over preferred_date_1", async () => {
    mockClient.current!._setTable("academic_event_applications", [
      row({ id: "moved-later", finalized_date: "2026-10-20", preferred_date_1: "2026-09-01" }),
    ])
    expect((await (await GET(req(authed))).json()).completed).toBe(0)
  })

  it("holds a multi-day course until the linked event end_date has passed", async () => {
    mockClient.current!._setTable("academic_event_applications", [
      row({ id: "course", finalized_date: "2026-10-08", created_event_id: "evt-1" }),
    ])
    mockClient.current!._setTable("events", [{ id: "evt-1", end_date: "2026-10-10" }])
    expect((await (await GET(req(authed))).json()).completed).toBe(0)
    mockClient.current!._setTable("events", [{ id: "evt-1", end_date: "2026-10-09" }])
    expect((await (await GET(req(authed))).json()).completed).toBe(1)
  })

  it.each(["submitted", "under_review", "changes_requested", "rejected", "completed", "cancelled"])(
    "never touches a %s application",
    async (status) => {
      mockClient.current!._setTable("academic_event_applications", [row({ status, updated_at: "2026-08-01T00:00:00Z" })])
      const body = await (await GET(req(authed))).json()
      expect(body.completed).toBe(0)
      expect(apps()[0].status).toBe(status)
      expect(apps()[0].updated_at).toBe("2026-08-01T00:00:00Z")
      expect(audit()).toHaveLength(0)
    }
  )

  it("never completes an application with no usable date", async () => {
    mockClient.current!._setTable("academic_event_applications", [row({ preferred_date_1: null })])
    expect((await (await GET(req(authed))).json()).completed).toBe(0)
  })

  it("is idempotent: a second run changes nothing and writes no second audit row", async () => {
    await GET(req(authed))
    const second = await (await GET(req(authed))).json()
    expect(second).toMatchObject({ completed: 0, skipped: 0 })
    expect(audit()).toHaveLength(1)
  })

  it("compare-and-set: a row an admin changed after our read is not overwritten", async () => {
    // Simulate the race: the SELECT sees 'approved', but by UPDATE time the row is 'rejected'.
    const client = mockClient.current!
    const realFrom = client.from
    client.from = ((table: string) => {
      const b = realFrom(table)
      if (table === "academic_event_applications") {
        const realUpdate = b.update
        b.update = (patch: Record<string, unknown>) => {
          client._tables.get(table)![0].status = "rejected"
          return realUpdate(patch)
        }
      }
      return b
    }) as typeof client.from
    const body = await (await GET(req(authed))).json()
    expect(body).toMatchObject({ completed: 0, skipped: 1 })
    expect(apps()[0].status).toBe("rejected")
    expect(audit()).toHaveLength(0)
  })

  it("caps the number moved per run and reports the rest as deferred", async () => {
    const many = Array.from({ length: MOU_AUTO_COMPLETE_MAX_PER_RUN + 7 }, (_, i) =>
      row({ id: `app-${i}`, created_at: `2026-08-01T00:${String(i % 60).padStart(2, "0")}:00Z` })
    )
    mockClient.current!._setTable("academic_event_applications", many)
    const body = await (await GET(req(authed))).json()
    expect(body.completed).toBe(MOU_AUTO_COMPLETE_MAX_PER_RUN)
    expect(body.deferred).toBe(7)
    expect(apps().filter((a) => a.status === "approved")).toHaveLength(7)
    // next run picks up the remainder
    const next = await (await GET(req(authed))).json()
    expect(next.completed).toBe(7)
  })

  it("dryRun reports what would change and writes nothing (no status change, audit, or heartbeat)", async () => {
    const body = await (await GET(req(authed, "?dryRun=true"))).json()
    expect(body).toMatchObject({ dryRun: true, completedIds: ["app-1"], completed: 0 })
    expect(apps()[0].status).toBe("approved")
    expect(audit()).toHaveLength(0)
    expect(heartbeatMock).not.toHaveBeenCalled()
  })

  it("500s with a generic message when the candidate fetch fails", async () => {
    mockClient.current = {
      from: () => {
        const b: Record<string, unknown> = {}
        for (const m of ["select", "eq", "or", "order", "limit", "in", "update", "insert", "upsert"]) b[m] = () => b
        b.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: { message: "boom secret detail" } })
        return b
      },
    } as unknown as typeof mockClient.current
    const res = await GET(req(authed))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain("secret detail")
    expect(heartbeatMock).toHaveBeenCalledWith("mou-auto-complete", { success: false, error: expect.any(String) })
  })
})

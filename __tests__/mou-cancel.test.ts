import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({ getAdminSession: vi.fn() }))
vi.mock("@/lib/mou/supabase-helpers", () => ({ getApplicationById: vi.fn() }))
vi.mock("@/lib/audit-log", () => ({ logAdminAction: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))

const { appUpdate, eventUpdate, appMaybeSingle, eventEq } = vi.hoisted(() => {
  const appMaybeSingle = vi.fn()
  const eventEq = vi.fn()
  const appUpdate = vi.fn()
  const eventUpdate = vi.fn()
  return { appUpdate, eventUpdate, appMaybeSingle, eventEq }
})
vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "academic_event_applications") {
        return {
          update: (vals: unknown) => {
            appUpdate(vals)
            return { eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: appMaybeSingle }) }) }) }
          },
        }
      }
      return {
        update: (vals: unknown) => {
          eventUpdate(vals)
          return { eq: eventEq }
        },
      }
    },
  }),
}))

import { POST } from "@/app/api/admin/mou-applications/[id]/cancel/route"
import { getAdminSession } from "@/lib/auth"
import { getApplicationById } from "@/lib/mou/supabase-helpers"
import { logAdminAction } from "@/lib/audit-log"

const ctx = { params: Promise.resolve({ id: "app-1" }) }
const post = (body: unknown) =>
  POST(
    new NextRequest("https://test.local/api/admin/mou-applications/app-1/cancel", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    ctx
  )

describe("POST /api/admin/mou-applications/[id]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getAdminSession).mockResolvedValue({ email: "admin@amasi.org", name: "Admin" } as never)
    vi.mocked(getApplicationById).mockResolvedValue({
      id: "app-1",
      status: "approved",
      event_name: "Bhagalpur NextGen",
      organizer_name: "Prof. K",
      created_event_id: "ev-1",
    } as never)
    appMaybeSingle.mockResolvedValue({ data: { id: "app-1" }, error: null })
    eventEq.mockResolvedValue({ error: null })
  })

  it("401s without an admin session", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null)
    expect((await post({ reason: "clash with another conference" })).status).toBe(401)
    expect(appUpdate).not.toHaveBeenCalled()
  })

  it("requires a real reason", async () => {
    expect((await post({})).status).toBe(400)
    expect((await post({ reason: "  no " })).status).toBe(400)
    expect((await post({ reason: "x".repeat(1001) })).status).toBe(400)
    expect((await post("not json")).status).toBe(400)
    expect(appUpdate).not.toHaveBeenCalled()
  })

  it("404s for an unknown application", async () => {
    vi.mocked(getApplicationById).mockResolvedValue(null as never)
    expect((await post({ reason: "clash with another conference" })).status).toBe(404)
  })

  it("only cancels approved applications", async () => {
    for (const status of ["submitted", "completed", "rejected", "cancelled"]) {
      vi.mocked(getApplicationById).mockResolvedValue({ id: "app-1", status } as never)
      expect((await post({ reason: "clash with another conference" })).status).toBe(400)
    }
    expect(appUpdate).not.toHaveBeenCalled()
  })

  it("cancels the application, closes the linked event, and writes an audit entry", async () => {
    const res = await post({ reason: "  Clashes with Jharkhand ASICON  " })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: true, eventCancelled: true })
    expect(appUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        cancelled_by: "admin@amasi.org",
        cancellation_reason: "Clashes with Jharkhand ASICON",
      })
    )
    expect(eventUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled", registration_open: false }))
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mou_application_cancelled", entityId: "app-1" })
    )
  })

  it("409s when the status changed under it (compare-and-set lost) and does not touch the event", async () => {
    appMaybeSingle.mockResolvedValue({ data: null, error: null })
    expect((await post({ reason: "clash with another conference" })).status).toBe(409)
    expect(eventUpdate).not.toHaveBeenCalled()
    expect(logAdminAction).not.toHaveBeenCalled()
  })

  it("still reports success but flags it when the linked event could not be closed", async () => {
    eventEq.mockResolvedValue({ error: { message: "boom" } })
    const res = await post({ reason: "clash with another conference" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: true, eventCancelled: false })
  })

  it("skips the event update when no event was ever created", async () => {
    vi.mocked(getApplicationById).mockResolvedValue({ id: "app-1", status: "approved", created_event_id: null } as never)
    const res = await post({ reason: "clash with another conference" })
    expect(await res.json()).toEqual({ status: true, eventCancelled: null })
    expect(eventUpdate).not.toHaveBeenCalled()
  })
})

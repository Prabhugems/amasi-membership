/**
 * Route-level tests for POST /api/admin/drafts/[id]/complete-and-submit.
 * The shared reconstruction logic (promoteDraftToApplication) is mocked
 * here and already has its own coverage in
 * __tests__/promote-draft-to-application.test.ts — this file only tests
 * auth/status-gating glue: load, guard, look up payment, check for an
 * existing application, call the lib, map its result.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const state = vi.hoisted(() => ({
  sessionMock: vi.fn(async () => ({ email: "admin@test.com", name: "Admin", adminRole: "super_admin" })),
  promoteMock: vi.fn(),
  logAdminActionMock: vi.fn(async () => undefined),
  draftRow: null as Record<string, unknown> | null,
  paymentRow: null as Record<string, unknown> | null,
  existingAppRow: null as Record<string, unknown> | null,
  paymentQueryCalls: [] as [string, ...unknown[]][],
  appQueryCalls: [] as [string, ...unknown[]][],
}))

vi.mock("@/lib/auth", () => ({
  getAdminSession: state.sessionMock,
}))

vi.mock("@/lib/promote-draft-to-application", () => ({
  promoteDraftToApplication: state.promoteMock,
}))

vi.mock("@/lib/audit-log", () => ({
  logAdminAction: state.logAdminActionMock,
}))

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}))

function draftApplicationsBuilder() {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = () => b
  b.maybeSingle = async () => ({ data: state.draftRow, error: null })
  return b
}

function membershipPaymentsBuilder() {
  const b: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    state.paymentQueryCalls.push([name, ...args])
    return b
  }
  b.select = record("select")
  b.ilike = record("ilike")
  b.eq = record("eq")
  b.is = record("is")
  b.order = record("order")
  b.limit = record("limit")
  b.maybeSingle = async () => ({ data: state.paymentRow, error: null })
  return b
}

function membershipApplicationsBuilder() {
  const b: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    state.appQueryCalls.push([name, ...args])
    return b
  }
  b.select = record("select")
  b.eq = record("eq")
  b.neq = record("neq")
  b.order = record("order")
  b.limit = record("limit")
  b.maybeSingle = async () => ({ data: state.existingAppRow, error: null })
  return b
}

vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "draft_applications") return draftApplicationsBuilder()
      if (table === "membership_payments") return membershipPaymentsBuilder()
      if (table === "membership_applications") return membershipApplicationsBuilder()
      throw new Error(`Unmocked table: ${table}`)
    },
  })),
}))

import { POST } from "@/app/api/admin/drafts/[id]/complete-and-submit/route"
import type { NextRequest } from "next/server"

function buildRequest(): NextRequest {
  return new Request("https://test.local/api/admin/drafts/draft-1/complete-and-submit", {
    method: "POST",
  }) as unknown as NextRequest
}

function call() {
  return POST(buildRequest(), { params: Promise.resolve({ id: "draft-1" }) })
}

const validDraft = {
  id: "draft-1",
  email: "kaustubh@example.com",
  status: "payment_on_hold",
  step_data: { formData: { firstName: "Kaustubh" }, uploads: { photo: {} } },
}

const validPayment = { id: "payrow-1", gateway_payment_id: "pay_ABC123", amount: 5000, currency: "INR" }

beforeEach(() => {
  vi.clearAllMocks()
  state.sessionMock.mockResolvedValue({ email: "admin@test.com", name: "Admin", adminRole: "super_admin" })
  state.promoteMock.mockResolvedValue({ ok: true, applicationId: "app-1", referenceNumber: "AMASI-2026-REF" })
  state.draftRow = validDraft
  state.paymentRow = validPayment
  state.existingAppRow = null
  state.paymentQueryCalls = []
  state.appQueryCalls = []
})

describe("POST /api/admin/drafts/[id]/complete-and-submit", () => {
  it("401s when there is no session", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state.sessionMock.mockResolvedValue(null as any)
    const res = await call()
    expect(res.status).toBe(401)
  })

  it("403s for a non-super_admin session", async () => {
    state.sessionMock.mockResolvedValue({ email: "a@test.com", name: "Admin", adminRole: "admin" })
    const res = await call()
    expect(res.status).toBe(403)
  })

  it("404s when the draft doesn't exist", async () => {
    state.draftRow = null
    const res = await call()
    expect(res.status).toBe(404)
  })

  it("409s for a draft not in payment_on_hold, with the actual status in the message", async () => {
    state.draftRow = { ...validDraft, status: "stuck" }
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.error).toMatch(/stuck/)
  })

  it("422s when there is no unlinked paid payment", async () => {
    state.paymentRow = null
    const res = await call()
    expect(res.status).toBe(422)
    expect(state.promoteMock).not.toHaveBeenCalled()
  })

  it("queries membership_payments with the application_id IS NULL guard", async () => {
    await call()
    const isCalls = state.paymentQueryCalls.filter((c) => c[0] === "is")
    expect(isCalls).toContainEqual(["is", "application_id", null])
  })

  it("409s ALREADY_EXISTS when an application already exists (not pending_payment, not rejected)", async () => {
    state.existingAppRow = { id: "app-existing", reference_number: "AMASI-2026-OLD" }
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe("ALREADY_EXISTS")
    expect(body.applicationId).toBe("app-existing")
    expect(state.promoteMock).not.toHaveBeenCalled()
  })

  it("excludes both pending_payment and rejected from the duplicate-application check", async () => {
    await call()
    const neqCalls = state.appQueryCalls.filter((c) => c[0] === "neq")
    expect(neqCalls).toContainEqual(["neq", "status", "pending_payment"])
    expect(neqCalls).toContainEqual(["neq", "status", "rejected"])
  })

  it("422s when the draft lacks formData/uploads (canReconstruct guard)", async () => {
    state.draftRow = { ...validDraft, step_data: {} }
    const res = await call()
    expect(res.status).toBe(422)
    expect(state.promoteMock).not.toHaveBeenCalled()
  })

  it("409s ALREADY_EXISTS_RACE, passing the lib's message through, no audit log", async () => {
    state.promoteMock.mockResolvedValue({ ok: false, code: "ALREADY_EXISTS_RACE", message: "raced" })
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe("ALREADY_EXISTS_RACE")
    expect(body.error).toBe("raced")
    expect(state.logAdminActionMock).not.toHaveBeenCalled()
  })

  it("500s LINK_FAILED, passing applicationId through, AND logs the admin action with linkFailed: true", async () => {
    state.promoteMock.mockResolvedValue({
      ok: false,
      code: "LINK_FAILED",
      applicationId: "app-1",
      referenceNumber: "AMASI-2026-REF",
      message: "link broke",
    })
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.code).toBe("LINK_FAILED")
    expect(body.applicationId).toBe("app-1")
    expect(state.logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "draft_complete_and_submit",
        entityId: "app-1",
        details: expect.objectContaining({ linkFailed: true, paymentRowId: "payrow-1" }),
      }),
    )
  })

  it("happy path: 200, returns applicationId/referenceNumber, logs the admin action without linkFailed", async () => {
    state.promoteMock.mockResolvedValue({ ok: true, applicationId: "app-1", referenceNumber: "AMASI-2026-REF" })
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, applicationId: "app-1", referenceNumber: "AMASI-2026-REF" })
    expect(state.logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "draft_complete_and_submit", entityId: "app-1" }),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const logCall = (state.logAdminActionMock.mock.calls as any)[0]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const details = (logCall?.[0] as any)?.details
    expect(details?.linkFailed).toBeUndefined()
  })
})

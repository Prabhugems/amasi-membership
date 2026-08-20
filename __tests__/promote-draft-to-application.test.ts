/**
 * Characterization tests for promoteDraftToApplication() — extracted
 * 2026-08-20 from orphan-payments/promote/route.ts's draft-mode branch.
 * Every case here pins a specific behavior from the live route as it stood
 * at extraction time; this is the FIRST test coverage this logic has ever
 * had (grep -rl "orphan-payments/promote" __tests__/ returned nothing
 * before this file existed). See docs/superpowers/specs/2026-08-20-draft-
 * rescue-design.md §1 and §4.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const state = vi.hoisted(() => ({
  scoreApplicationMock: vi.fn(),
  buildApplicationRowMock: vi.fn(() => ({ mocked: "row" })),
  generateRefNumberMock: vi.fn(() => "AMASI-2026-FIXEDREF"),
  sentryCaptureMock: vi.fn(),
  pendingRow: null as { id: string; reference_number: string } | null,
  finalizeResult: { data: null as { id: string } | null, error: null as unknown },
  insertResult: { data: null as { id: string } | null, error: null as unknown },
  linkResult: { error: null as unknown },
  draftUpdateResult: { error: null as unknown },
  draftUpdateCalled: false,
}))

vi.mock("@sentry/nextjs", () => ({
  captureException: state.sentryCaptureMock,
}))

vi.mock("@/lib/ai-approval", () => ({
  scoreApplication: state.scoreApplicationMock,
}))

vi.mock("@/lib/build-application-row", () => ({
  buildApplicationRow: state.buildApplicationRowMock,
}))

vi.mock("@/lib/reference-number", () => ({
  generateRefNumber: state.generateRefNumberMock,
}))

function membershipApplicationsBuilder() {
  let verb: "select" | "update" | "insert" | null = null
  const b: Record<string, unknown> = {}
  b.select = () => { if (verb === null) verb = "select"; return b }
  b.update = () => { verb = "update"; return b }
  b.insert = () => { verb = "insert"; return b }
  b.eq = () => b
  b.order = () => b
  b.limit = () => b
  b.maybeSingle = async () => {
    if (verb === "select") return { data: state.pendingRow, error: null }
    if (verb === "update") return state.finalizeResult
    return { data: null, error: null }
  }
  b.single = async () => state.insertResult
  return b
}

function membershipPaymentsBuilder() {
  const b: Record<string, unknown> = {}
  b.update = () => b
  b.eq = () => b
  b.is = () => b
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(state.linkResult).then(resolve, reject)
  return b
}

function draftApplicationsBuilder() {
  const b: Record<string, unknown> = {}
  b.update = () => { state.draftUpdateCalled = true; return b }
  b.eq = () => b
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(state.draftUpdateResult).then(resolve, reject)
  return b
}

const supabase = {
  from: (table: string) => {
    if (table === "membership_applications") return membershipApplicationsBuilder()
    if (table === "membership_payments") return membershipPaymentsBuilder()
    if (table === "draft_applications") return draftApplicationsBuilder()
    throw new Error(`Unmocked table: ${table}`)
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

import { promoteDraftToApplication } from "@/lib/promote-draft-to-application"

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    draft: {
      id: "draft-1",
      email: "kaustubh@example.com",
      step_data: { formData: { firstName: "Kaustubh" }, uploads: { photo: { fileUrl: "photo/x.jpg" } } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    email: "kaustubh@example.com",
    paymentId: "pay_ABC123",
    paymentRowId: "payrow-1",
    actorReason: "test reason",
    routeTag: "test/route",
    ...overrides,
  }
}

function normalApproval(overrides: Record<string, unknown> = {}) {
  return {
    totalScore: 85,
    autoApprove: true,
    blockingReasons: [],
    checks: [],
    flags: [],
    nmcVerification: null,
    nmcApiStatus: null,
    nmcResponseTimeMs: null,
    bypassedDocs: [],
    lowConfidenceDocs: [],
    mediumConfidenceDocs: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.pendingRow = null
  state.finalizeResult = { data: null, error: null }
  state.insertResult = { data: { id: "app-1" }, error: null }
  state.linkResult = { error: null }
  state.draftUpdateResult = { error: null }
  state.draftUpdateCalled = false
  state.scoreApplicationMock.mockResolvedValue(normalApproval())
})

describe("promoteDraftToApplication", () => {
  it("happy path: fresh insert, links payment, soft-completes draft", async () => {
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result).toEqual({ ok: true, applicationId: "app-1", referenceNumber: "AMASI-2026-FIXEDREF" })
    expect(state.scoreApplicationMock).toHaveBeenCalledWith(
      { firstName: "Kaustubh" },
      { photo: { fileUrl: "photo/x.jpg" } },
      true,
      supabase,
    )
    expect(state.draftUpdateCalled).toBe(true)
    expect(state.sentryCaptureMock).not.toHaveBeenCalled()
  })

  it("finalizes an existing pending_payment skeleton in place instead of inserting fresh", async () => {
    state.pendingRow = { id: "skeleton-1", reference_number: "AMASI-2026-OLDREF" }
    state.finalizeResult = { data: { id: "skeleton-1" }, error: null }
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result).toEqual({ ok: true, applicationId: "skeleton-1", referenceNumber: "AMASI-2026-OLDREF" })
    expect(state.generateRefNumberMock).not.toHaveBeenCalled()
  })

  it("falls back to a neutral approval when scoring throws, and still succeeds", async () => {
    state.scoreApplicationMock.mockRejectedValueOnce(new Error("network down"))
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result.ok).toBe(true)
    expect(state.sentryCaptureMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ level: "warning", tags: expect.objectContaining({ op: "scoring_failed" }) }),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowArgs = (state.buildApplicationRowMock.mock.calls as unknown[][])[0][0] as any
    expect(rowArgs.approval).toMatchObject({ totalScore: 0, autoApprove: false, blockingReasons: ["scoring_skipped"] })
  })

  it("routes documents_unreadable decisions to applicationStatus 'documents_unreadable'", async () => {
    state.scoreApplicationMock.mockResolvedValue(normalApproval({ decision: "documents_unreadable", totalScore: 0 }))
    await promoteDraftToApplication(baseInput(), supabase)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowArgs = (state.buildApplicationRowMock.mock.calls as unknown[][])[0][0] as any
    expect(rowArgs.documentsUnreadable).toBe(true)
    expect(rowArgs.applicationStatus).toBe("documents_unreadable")
  })

  it("returns ALREADY_EXISTS_RACE when the finalize update loses a race (0 rows matched)", async () => {
    state.pendingRow = { id: "skeleton-1", reference_number: "AMASI-2026-OLDREF" }
    state.finalizeResult = { data: null, error: null }
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result).toEqual({
      ok: false,
      code: "ALREADY_EXISTS_RACE",
      message: "Application was just finalized elsewhere.",
    })
  })

  it("returns ALREADY_EXISTS_RACE (distinct message) when the insert throws Postgres 23505", async () => {
    state.insertResult = { data: null, error: { code: "23505", message: "duplicate key" } }
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result).toEqual({
      ok: false,
      code: "ALREADY_EXISTS_RACE",
      message: "An active application already exists for this applicant.",
    })
  })

  it("propagates any other thrown insert error instead of swallowing it", async () => {
    state.insertResult = { data: null, error: { code: "OTHER", message: "boom" } }
    await expect(promoteDraftToApplication(baseInput(), supabase)).rejects.toMatchObject({ code: "OTHER" })
  })

  it("LINK_FAILED: returns the applicationId + referenceNumber, and NEVER soft-completes the draft", async () => {
    state.linkResult = { error: { message: "link boom" } }
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result).toEqual({
      ok: false,
      code: "LINK_FAILED",
      applicationId: "app-1",
      referenceNumber: "AMASI-2026-FIXEDREF",
      message: "Application created but payment link failed. Please retry.",
    })
    expect(state.draftUpdateCalled).toBe(false)
    expect(state.sentryCaptureMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ level: "error", tags: expect.objectContaining({ op: "link_failed" }) }),
    )
  })

  it("never sets allAiVerified: true, even for a perfect score — this path never auto-approves", async () => {
    state.scoreApplicationMock.mockResolvedValue(normalApproval({ totalScore: 100, autoApprove: true }))
    await promoteDraftToApplication(baseInput(), supabase)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowArgs = (state.buildApplicationRowMock.mock.calls as unknown[][])[0][0] as any
    expect(rowArgs.allAiVerified).toBe(false)
  })
})

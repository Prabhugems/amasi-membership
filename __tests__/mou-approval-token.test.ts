import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn().mockResolvedValue({ error: null })
const singleMock = vi.fn()
const updateEqMock = vi.fn().mockResolvedValue({ error: null })

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: insertMock,
      select: () => ({ eq: () => ({ single: singleMock }) }),
      update: () => ({ eq: updateEqMock }),
    }),
  }),
}))

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))

import { createApprovalToken, verifyApprovalToken, markTokenUsed } from "@/lib/mou/approval-token"
import * as Sentry from "@sentry/nextjs"

beforeEach(() => {
  vi.clearAllMocks()
  insertMock.mockResolvedValue({ error: null })
  updateEqMock.mockResolvedValue({ error: null })
})

describe("createApprovalToken", () => {
  it("inserts a hashed token and returns the raw token to the caller", async () => {
    const raw = await createApprovalToken("app-1", "hon_secretary", true)
    expect(typeof raw).toBe("string")
    expect(raw.length).toBeGreaterThanOrEqual(32)
    const inserted = insertMock.mock.calls[0][0]
    expect(inserted.application_id).toBe("app-1")
    expect(inserted.token_hash).not.toBe(raw) // never store the raw token
  })

  it("throws and captures to Sentry when the Supabase insert reports an error", async () => {
    insertMock.mockResolvedValueOnce({ error: { message: "insert failed" } })
    await expect(createApprovalToken("app-1", "hon_secretary", true)).rejects.toThrow()
    expect(Sentry.captureException).toHaveBeenCalled()
  })
})

describe("markTokenUsed", () => {
  it("does not throw and captures to Sentry when the Supabase update reports an error", async () => {
    updateEqMock.mockResolvedValueOnce({ error: { message: "update failed" } })
    await expect(markTokenUsed("some-raw-token", "approved")).resolves.not.toThrow()
    expect(Sentry.captureException).toHaveBeenCalled()
  })

  it("does not capture to Sentry when the update succeeds", async () => {
    await markTokenUsed("some-raw-token", "approved")
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})

describe("verifyApprovalToken", () => {
  it("rejects an expired token", async () => {
    singleMock.mockResolvedValueOnce({
      data: { id: "t1", expires_at: new Date(Date.now() - 1000).toISOString(), used_at: null, can_decide: true },
      error: null,
    })
    const result = await verifyApprovalToken("some-raw-token")
    expect(result.ok).toBe(false)
  })

  it("rejects an already-used token", async () => {
    singleMock.mockResolvedValueOnce({
      data: { id: "t1", expires_at: new Date(Date.now() + 100000).toISOString(), used_at: new Date().toISOString(), can_decide: true },
      error: null,
    })
    const result = await verifyApprovalToken("some-raw-token")
    expect(result.ok).toBe(false)
  })

  it("accepts a valid, unused, unexpired token", async () => {
    singleMock.mockResolvedValueOnce({
      data: { id: "t1", expires_at: new Date(Date.now() + 100000).toISOString(), used_at: null, can_decide: true },
      error: null,
    })
    const result = await verifyApprovalToken("some-raw-token")
    expect(result.ok).toBe(true)
  })
})

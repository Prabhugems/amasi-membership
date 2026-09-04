import { describe, it, expect, vi } from "vitest"

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

import { createApprovalToken, verifyApprovalToken } from "@/lib/mou/approval-token"

describe("createApprovalToken", () => {
  it("inserts a hashed token and returns the raw token to the caller", async () => {
    const raw = await createApprovalToken("app-1", "hon_secretary", true)
    expect(typeof raw).toBe("string")
    expect(raw.length).toBeGreaterThanOrEqual(32)
    const inserted = insertMock.mock.calls[0][0]
    expect(inserted.application_id).toBe("app-1")
    expect(inserted.token_hash).not.toBe(raw) // never store the raw token
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

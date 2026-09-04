import { describe, it, expect, vi, beforeEach } from "vitest"
import crypto from "crypto"

const insertMock = vi.fn()
const selectMock = vi.fn()
const singleMock = vi.fn()
const eqMock = vi.fn()
const updateMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: insertMock,
      update: updateMock,
    }),
  }),
}))
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))

import { computeMouHash, createMouSignature, markCounterSigned } from "@/lib/mou/mou-signature"
import * as Sentry from "@sentry/nextjs"

describe("computeMouHash", () => {
  it("matches a plain sha256 of the joined clauses + version", () => {
    const clauses = ["Clause one.", "Clause two."]
    const expected = crypto.createHash("sha256").update(clauses.join("\n") + "3").digest("hex")
    expect(computeMouHash(clauses, 3)).toBe(expected)
  })

  it("produces a different hash when the version changes but text doesn't", () => {
    const clauses = ["Same text."]
    expect(computeMouHash(clauses, 1)).not.toBe(computeMouHash(clauses, 2))
  })

  it("produces a different hash when the text changes but version doesn't", () => {
    expect(computeMouHash(["Text A"], 1)).not.toBe(computeMouHash(["Text B"], 1))
  })
})

describe("createMouSignature", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    singleMock.mockResolvedValue({
      data: {
        id: "sig-1", application_id: "app-1", mou_version: 1, mou_sha256: "abc",
        signatory_name: "Dr. Test", signatory_email: "test@example.com",
        signatory_amasi_number: null, otp_verified_at: "2026-09-04T00:00:00.000Z",
        accepted_at: "2026-09-04T00:00:00.000Z", ip_address: "1.2.3.4", user_agent: "test-agent",
        approved_by: null, approved_at: null, created_at: "2026-09-04T00:00:00.000Z",
      },
      error: null,
    })
    selectMock.mockReturnValue({ single: singleMock })
    insertMock.mockReturnValue({ select: selectMock })
  })

  it("inserts a signature row and returns it", async () => {
    const result = await createMouSignature({
      applicationId: "app-1",
      mouVersion: 1,
      mouSha256: "abc",
      signatoryName: "Dr. Test",
      signatoryEmail: "test@example.com",
      signatoryAmasiNumber: null,
      otpVerifiedAt: "2026-09-04T00:00:00.000Z",
      ipAddress: "1.2.3.4",
      userAgent: "test-agent",
    })
    expect(result.id).toBe("sig-1")
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        application_id: "app-1",
        mou_version: 1,
        mou_sha256: "abc",
        ip_address: "1.2.3.4",
      })
    )
  })

  it("throws and captures to Sentry when the insert fails", async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: "insert failed" } })
    await expect(
      createMouSignature({
        applicationId: "app-1", mouVersion: 1, mouSha256: "abc",
        signatoryName: "Dr. Test", signatoryEmail: "test@example.com",
        signatoryAmasiNumber: null, otpVerifiedAt: "2026-09-04T00:00:00.000Z",
        ipAddress: "1.2.3.4", userAgent: null,
      })
    ).rejects.toThrow("insert failed")
    expect(Sentry.captureException).toHaveBeenCalled()
  })
})

describe("markCounterSigned", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eqMock.mockReturnValue({ eq: eqMock, then: undefined })
    updateMock.mockReturnValue({ eq: eqMock })
  })

  it("updates only approved_by/approved_at, scoped to application_id + mou_version + approved_at IS NULL", async () => {
    // Chain is .eq(application_id).eq(mou_version).is(approved_at, null) —
    // mock .is() to resolve, and the idempotency guard (Fix 2).
    const isMock = vi.fn().mockResolvedValue({ error: null })
    const secondEq = vi.fn().mockReturnValue({ is: isMock })
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
    updateMock.mockReturnValue({ eq: firstEq })

    await markCounterSigned("app-1", 1, "Dr. Biswarup Bose")

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ approved_by: "Dr. Biswarup Bose" })
    )
    const updateArg = updateMock.mock.calls[0][0]
    expect(Object.keys(updateArg).sort()).toEqual(["approved_at", "approved_by"])
    expect(firstEq).toHaveBeenCalledWith("application_id", "app-1")
    expect(secondEq).toHaveBeenCalledWith("mou_version", 1)
    expect(isMock).toHaveBeenCalledWith("approved_at", null)
  })

  it("captures to Sentry (does not throw) when the update fails — decision is already persisted by this point", async () => {
    const isMock = vi.fn().mockResolvedValue({ error: { message: "update failed" } })
    const secondEq = vi.fn().mockReturnValue({ is: isMock })
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
    updateMock.mockReturnValue({ eq: firstEq })

    await expect(markCounterSigned("app-1", 1, "Dr. Biswarup Bose")).resolves.not.toThrow()
    expect(Sentry.captureException).toHaveBeenCalled()
  })

  it("does not re-stamp an already counter-signed row on retry (idempotent — Fix 2)", async () => {
    // .is("approved_at", null) is what the DB itself enforces this with —
    // when a row already has approved_at set, the update matches zero rows
    // and Supabase returns { error: null, data: [] } (no error, just no
    // rows touched). This test documents that a retry is safe: no error is
    // thrown even though nothing was updated.
    const isMock = vi.fn().mockResolvedValue({ error: null })
    const secondEq = vi.fn().mockReturnValue({ is: isMock })
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
    updateMock.mockReturnValue({ eq: firstEq })

    await expect(markCounterSigned("app-1", 1, "Dr. Biswarup Bose")).resolves.not.toThrow()
    expect(isMock).toHaveBeenCalledWith("approved_at", null)
    expect(Sentry.captureException).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn().mockResolvedValue({ error: null })
const singleMock = vi.fn()
const updateMock = vi.fn().mockResolvedValue({ error: null })

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "otp_codes") throw new Error(`unexpected table ${table}`)
      return {
        insert: insertMock,
        select: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({
                order: () => ({
                  limit: () => ({ single: singleMock }),
                }),
              }),
            }),
          }),
        }),
        update: () => ({ eq: updateMock }),
      }
    },
  }),
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() }),
}))

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn().mockResolvedValue({ data: { id: "test" }, error: null }) }
  },
}))

import { sendMouOtp, verifyMouOtp } from "@/lib/mou/otp"
import { hashOtp } from "@/lib/otp-hash"

describe("sendMouOtp", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-key"
    insertMock.mockClear()
  })

  it("rejects an invalid email shape", async () => {
    const result = await sendMouOtp("not-an-email")
    expect(result.ok).toBe(false)
  })

  it("inserts a hashed OTP row for a valid email", async () => {
    const result = await sendMouOtp("organizer@example.com")
    expect(result.ok).toBe(true)
    expect(insertMock).toHaveBeenCalledTimes(1)
    const inserted = insertMock.mock.calls[0][0]
    expect(inserted.email).toBe("organizer@example.com")
    expect(inserted.code_hash).toHaveLength(64) // sha256 hex
  })
})

describe("verifyMouOtp", () => {
  it("fails when no matching OTP row exists", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "no rows" } })
    const result = await verifyMouOtp("organizer@example.com", "123456")
    expect(result.ok).toBe(false)
  })

  it("succeeds when the code matches the stored hash", async () => {
    singleMock.mockResolvedValueOnce({
      data: { id: "otp-1", code_hash: hashOtp("654321"), attempts: 0, email: "organizer@example.com" },
      error: null,
    })
    const result = await verifyMouOtp("organizer@example.com", "654321")
    expect(result.ok).toBe(true)
  })
})

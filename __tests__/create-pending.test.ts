/**
 * /api/applications/create-pending — WS-C commit 2 regression tests.
 *
 * Contract under test:
 *   - Flag OFF (default) → 404, no DB write.
 *   - Flag ON + valid input + no existing row → 201 with new applicationId.
 *   - Second call with same (email, membership_type) → 200 idempotent=true.
 *   - Existing non-pending_payment row → 409 ALREADY_EXISTS, no DB write.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetAt: Date.now() + 1000 })),
}))

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

type AppRow = { id: string; reference_number: string; status: string }
let existingApp: AppRow | null = null
let otpVerified = true
const insertFn = vi.fn(async () => ({ data: { id: "app-new-uuid" }, error: null }))

vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "otp_codes") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: otpVerified ? { id: "otp-1" } : null,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === "membership_applications") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: existingApp, error: null }),
                  }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: insertFn,
            }),
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
  })),
}))

import { POST } from "@/app/api/applications/create-pending/route"
import type { NextRequest } from "next/server"

function buildRequest(body: Record<string, unknown>): NextRequest {
  return new Request("https://test.local/api/applications/create-pending", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const validBody = {
  email: "applicant@example.com",
  membershipType: "LM",
  referenceNumber: "AMASI-2026-ABCDEF1234",
  name: "Dr Test",
}

beforeEach(() => {
  existingApp = null
  otpVerified = true
  insertFn.mockClear()
  insertFn.mockResolvedValue({ data: { id: "app-new-uuid" }, error: null })
  delete process.env.WSC_EARLY_APPLICATION_ENABLED
})

describe("/api/applications/create-pending", () => {
  it("returns 404 when flag is OFF (default)", async () => {
    const res = await POST(buildRequest(validBody))
    expect(res.status).toBe(404)
    expect(insertFn).not.toHaveBeenCalled()
  })

  it("creates a pending_payment row on first call; returns idempotent on second", async () => {
    process.env.WSC_EARLY_APPLICATION_ENABLED = "true"

    const first = await POST(buildRequest(validBody))
    const firstBody = await first.json()
    expect(first.status).toBe(201)
    expect(firstBody.status).toBe(true)
    expect(firstBody.applicationId).toBe("app-new-uuid")
    expect(firstBody.idempotent).toBe(false)
    expect(insertFn).toHaveBeenCalledTimes(1)

    existingApp = {
      id: "app-new-uuid",
      reference_number: "AMASI-2026-ABCDEF1234",
      status: "pending_payment",
    }

    const second = await POST(buildRequest(validBody))
    const secondBody = await second.json()
    expect(second.status).toBe(200)
    expect(secondBody.status).toBe(true)
    expect(secondBody.applicationId).toBe("app-new-uuid")
    expect(secondBody.idempotent).toBe(true)
    expect(insertFn).toHaveBeenCalledTimes(1)
  })

  it("returns 409 ALREADY_EXISTS when a non-pending_payment row exists", async () => {
    process.env.WSC_EARLY_APPLICATION_ENABLED = "true"
    existingApp = {
      id: "app-approved-uuid",
      reference_number: "AMASI-2026-ABCDEF1234",
      status: "approved",
    }

    const res = await POST(buildRequest(validBody))
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.status).toBe(false)
    expect(body.code).toBe("ALREADY_EXISTS")
    expect(body.referenceNumber).toBe("AMASI-2026-ABCDEF1234")
    expect(insertFn).not.toHaveBeenCalled()
  })
})

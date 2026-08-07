/**
 * Regression test: /api/applications/resubmit must not persist
 * middle_name === first_name (case-insensitive) — the resubmit flow lets
 * applicants re-upload documents, which re-runs OCR extraction and can
 * reproduce the "Shivani Shivani Samaiya" duplicate that
 * src/lib/normalize-name.ts was built to close. See that file's header for
 * incident context.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetAt: 0 })),
}))

vi.mock("@/lib/ai-approval", () => ({
  toScorerFormShape: vi.fn((row: unknown) => row),
  scoreApplication: vi.fn(async () => ({
    totalScore: 90,
    autoApprove: true,
    flags: [],
    checks: [],
    nmcVerification: null,
  })),
}))

vi.mock("@/lib/ai-decision-log", () => ({
  logAiDecision: vi.fn(async () => undefined),
  updateAiDecisionOutcome: vi.fn(async () => undefined),
}))

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn(async () => ({ data: { id: "email_test" }, error: null })) }
  },
}))

let appRow: Record<string, unknown> | null = null
const capturedUpdates: Record<string, unknown>[] = []

vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "membership_applications") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: appRow, error: appRow ? null : { message: "not found" } }),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            capturedUpdates.push(values)
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      if (table === "otp_codes") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                gte: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({ data: { id: "otp-1" }, error: null }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unmocked Supabase table: ${table}`)
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  })),
}))

process.env.RESEND_API_KEY = "test_resend_key_not_real"

import { POST } from "@/app/api/applications/resubmit/route"
import type { NextRequest } from "next/server"

function buildRequest(updates: Record<string, unknown>): NextRequest {
  const fd = new FormData()
  fd.append("data", JSON.stringify({ applicationId: "app-1", email: "shivani@example.com", updates }))
  return new Request("https://test.local/api/applications/resubmit", {
    method: "POST",
    body: fd,
  }) as unknown as NextRequest
}

const BASE_APP: Record<string, unknown> = {
  id: "app-1",
  email: "shivani@example.com",
  status: "need_clarification",
  reference_number: "AMASI-2026-TEST",
  membership_type: "LM",
  salutation: "Dr.",
  first_name: "Shivani",
  middle_name: "Anand",
  last_name: "Samaiya",
  documents: {},
}

beforeEach(() => {
  capturedUpdates.length = 0
  appRow = { ...BASE_APP }
})

describe("resubmit — middle_name/first_name dedup", () => {
  it("drops middle_name when this resubmit sets it equal to first_name", async () => {
    const res = await POST(buildRequest({ firstName: "Shivani", middleName: "Shivani", lastName: "Samaiya" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe(true)
    expect(capturedUpdates[0]).toMatchObject({ middle_name: null, name: "Shivani Samaiya" })
  })

  it("keeps a distinct middle_name untouched", async () => {
    const res = await POST(buildRequest({ firstName: "Shivani", middleName: "Kumari", lastName: "Samaiya" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe(true)
    expect(capturedUpdates[0]).toMatchObject({ middle_name: "Kumari", name: "Shivani Kumari Samaiya" })
  })

  it("dedupes against the existing first_name when only middleName is touched", async () => {
    // Application already has first_name="Shivani"; this resubmit only edits
    // middleName (e.g. applicant fixes a different field in the same form
    // submission) and sets it to a duplicate of the EXISTING first name.
    appRow = { ...BASE_APP, first_name: "Shivani", middle_name: "Anand" }
    const res = await POST(buildRequest({ middleName: "shivani" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe(true)
    expect(capturedUpdates[0].middle_name).toBeNull()
  })

  it("leaves middle_name untouched in the update payload when this resubmit doesn't edit it", async () => {
    const res = await POST(buildRequest({ pgCollege: "Grant Medical College" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe(true)
    expect(capturedUpdates[0]).not.toHaveProperty("middle_name")
    expect(capturedUpdates[0]).not.toHaveProperty("name")
  })
})

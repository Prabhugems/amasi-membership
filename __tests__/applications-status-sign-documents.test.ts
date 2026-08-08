/**
 * Regression test: GET /api/applications/status must sign documents.*.fileUrl
 * on the full (owner-only) row before responding, the same fix applied to
 * /api/applications/list for the admin /pending dashboard. This route feeds
 * apply/resubmit's "currently uploaded" document preview.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetAt: 0 })),
}))

vi.mock("@/lib/auth", () => ({
  getMemberSession: vi.fn(async () => ({ email: "shivani@example.com" })),
}))

let appRow: Record<string, unknown> | null = null
const createSignedUrlsMock = vi.fn(async (paths: string[]) => ({
  data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}?token=abc` })),
  error: null,
}))

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
        }
      }
      throw new Error(`Unmocked Supabase table: ${table}`)
    },
    storage: { from: () => ({ createSignedUrls: createSignedUrlsMock }) },
  })),
}))

import { GET } from "@/app/api/applications/status/route"
import { NextRequest } from "next/server"

function buildRequest(ref: string): NextRequest {
  return new NextRequest(`https://test.local/api/applications/status?ref=${encodeURIComponent(ref)}`)
}

beforeEach(() => {
  createSignedUrlsMock.mockClear()
  appRow = {
    id: "app-1",
    reference_number: "AMASI-2026-TEST",
    email: "shivani@example.com",
    status: "need_clarification",
    documents: {
      profile: { status: "uploaded", fileUrl: "photo/1.jpg" },
      pg_degree_certificate: { status: "extracted", fileUrl: "pg_degree_certificate/2.pdf" },
    },
  }
})

describe("applications/status — documents signing on the owner-only full row", () => {
  it("signs documents.*.fileUrl when the caller owns the row", async () => {
    const res = await GET(buildRequest("AMASI-2026-TEST"))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.documents.profile.fileUrl).toBe("https://signed.example/photo/1.jpg?token=abc")
    expect(body.data.documents.pg_degree_certificate.fileUrl).toBe(
      "https://signed.example/pg_degree_certificate/2.pdf?token=abc",
    )
  })
})

/**
 * Regression test for the middleName≠firstName cross-field guard in
 * src/app/api/admin/drafts/[id]/edit-fields/route.ts.
 *
 * Bug: the guard originally evaluated against EFFECTIVE values (incoming ??
 * current) unconditionally, so an edit that never touched firstName/
 * middleName still got rejected if the draft already carried a pre-existing
 * OCR-era duplicate (see src/lib/normalize-name.ts). That contradicted the
 * route's own "tweak one field, hit Save" design goal. Fix: only enforce
 * the guard when the request actually touches firstName or middleName.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/auth", () => ({
  getAdminSession: vi.fn(async () => ({ email: "admin@test.com", adminRole: "super_admin" })),
}))

vi.mock("@/lib/audit-log", () => ({
  logMembershipAuditEvent: vi.fn(async () => undefined),
}))

let draftRow: Record<string, unknown> | null = null
let updateShouldMatch = true

vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== "draft_applications") {
        throw new Error(`Unmocked Supabase table: ${table}`)
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: draftRow, error: null }),
          }),
        }),
        update: () => ({
          eq: () => ({
            not: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: updateShouldMatch ? { id: "draft-1" } : null, error: null }),
              }),
            }),
          }),
        }),
      }
    },
  })),
}))

import { POST } from "@/app/api/admin/drafts/[id]/edit-fields/route"
import type { NextRequest } from "next/server"

function buildRequest(fields: Record<string, unknown>): NextRequest {
  return new Request("https://test.local/api/admin/drafts/draft-1/edit-fields", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  }) as unknown as NextRequest
}

beforeEach(() => {
  updateShouldMatch = true
})

describe("admin drafts edit-fields — middleName/firstName cross-field guard", () => {
  it("allows an unrelated field edit even when the draft already has a pre-existing name duplicate", async () => {
    draftRow = {
      id: "draft-1",
      status: "stuck",
      updated_at: "2026-01-01T00:00:00.000Z",
      step_data: { formData: { firstName: "Shivani", middleName: "Shivani", lastName: "Samaiya", mobile: "9000000000" } },
    }

    const res = await POST(buildRequest({ mobile: "9876543210" }), { params: Promise.resolve({ id: "draft-1" }) })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.updated).toMatchObject({ mobile: "9876543210" })
  })

  it("still rejects when the request itself would create a firstName/middleName duplicate", async () => {
    draftRow = {
      id: "draft-1",
      status: "stuck",
      updated_at: "2026-01-01T00:00:00.000Z",
      step_data: { formData: { firstName: "Shivani", middleName: "Anand", lastName: "Samaiya" } },
    }

    const res = await POST(buildRequest({ middleName: "Shivani" }), { params: Promise.resolve({ id: "draft-1" }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/middleName cannot equal firstName/)
  })

  it("still rejects when firstName is edited to newly match the existing middleName", async () => {
    draftRow = {
      id: "draft-1",
      status: "stuck",
      updated_at: "2026-01-01T00:00:00.000Z",
      step_data: { formData: { firstName: "Ravi", middleName: "Anand", lastName: "Samaiya" } },
    }

    const res = await POST(buildRequest({ firstName: "Anand" }), { params: Promise.resolve({ id: "draft-1" }) })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/middleName cannot equal firstName/)
  })
})

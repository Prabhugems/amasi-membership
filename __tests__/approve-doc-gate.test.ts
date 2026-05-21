/**
 * Approve-route document-validation gate.
 *
 * Covers the gate added in commit 67e8652 to `/api/applications/approve`:
 * before this fix, an admin could click Approve on an application whose
 * required documents were missing/invalid, and the handler happily wrote
 * a members row with `mci_certificate=null` / `letter_hod=null` etc.
 * (the kilroy ACM case, 2026-05-21).
 *
 * Gate skip conditions (both must be false to enforce):
 *   - `force === true`        — admin verified docs out-of-band
 *   - `app.member_id` is set  — re-approval of an already-linked row
 *
 * If the gate fires it MUST:
 *   - return HTTP 400
 *   - never call rpc("next_amasi_number")
 *   - never call members.insert
 *   - never update the application
 *   - return `missing` and `missingLabels` arrays in the body
 *
 * See also CONTEXT.md "Application → member field copy" fragile area and
 * the existing approve-idempotency.test.ts for the mock-shape precedent.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// ── Auth mock ────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  getAdminSession: vi.fn(async () => ({ email: "admin@test.com", name: "Test Admin" })),
}))

// ── Audit / AI decision mocks (not under test; prevent real DB calls) ────────
vi.mock("@/lib/audit-log", () => ({
  logAdminAction: vi.fn(async () => undefined),
}))
vi.mock("@/lib/ai-decision-log", () => ({
  updateAiDecisionOutcome: vi.fn(async () => undefined),
}))

// ── WhatsApp / Sentry mocks ──────────────────────────────────────────────────
vi.mock("@/lib/whatsapp", () => ({
  sendMemberApprovedWhatsApp: vi.fn(async () => undefined),
}))
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}))

// ── Supabase mock ────────────────────────────────────────────────────────────
const membersInsertFn = vi.fn(async () => ({ error: null }))
const rpcFn = vi.fn(async () => ({ data: 99999, error: null }))
const applicationUpdateFn = vi.fn(async () => ({ error: null }))
let applicationRow: Record<string, unknown> | null = null
let memberRow: Record<string, unknown> | null = null

vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "membership_applications") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: applicationRow,
                error: applicationRow ? null : { message: "not found" },
              }),
            }),
          }),
          update: () => ({ eq: applicationUpdateFn }),
        }
      }
      if (table === "members") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: memberRow, error: null }),
            }),
          }),
          insert: membersInsertFn,
          delete: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      throw new Error(`Unmocked Supabase table: ${table}`)
    },
    rpc: rpcFn,
  })),
}))

process.env.RESEND_API_KEY = "test_resend_key_not_real"

// Import AFTER mocks are wired
import { POST } from "@/app/api/applications/approve/route"
import type { NextRequest } from "next/server"

function buildRequest(body: Record<string, unknown>): NextRequest {
  return new Request("https://test.local/api/applications/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

// ACM application with incomplete documents — mirrors the kilroy 2026-05-21 case.
// ACM requires: mci_certificate, mbbs_degree_certificate, letter_hod, profile.
// We omit mci_certificate and letter_hod, and leave mbbs_degree_certificate
// with a non-extracted status, so the gate should fire with three missing keys.
const KILROY_INCOMPLETE_APP: Record<string, unknown> = {
  id: "app-kilroy-acm",
  status: "pending_review",
  member_id: null, // first approval — gate is enforced
  assigned_amasi_number: null,
  first_name: "Kilroy",
  middle_name: null,
  last_name: "Test",
  name: null,
  email: "kilroy@example.com",
  phone: "9876543211",
  mobile_code: "+91",
  salutation: "Dr.",
  membership_type: "ACM",
  reference_number: "AMASI-2026-KILROYTEST",
  documents: {
    photo: { status: "extracted", fileUrl: "https://storage.test/photo.jpg" },
    // mci_certificate: absent
    mbbs_degree_certificate: {
      status: "processing", // not "extracted" and not a valid bypass
      fileUrl: "https://storage.test/mbbs.jpg",
    },
    // letter_hod: absent
  },
}

beforeEach(() => {
  membersInsertFn.mockClear()
  rpcFn.mockClear()
  applicationUpdateFn.mockClear()
  applicationRow = null
  memberRow = null
})

describe("approve route document-validation gate (67e8652)", () => {
  it("returns 400 with missing/missingLabels and performs zero side-effects when docs incomplete", async () => {
    applicationRow = KILROY_INCOMPLETE_APP

    const res = await POST(buildRequest({ applicationId: "app-kilroy-acm" }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.status).toBe(false)
    expect(body.message).toMatch(/missing or invalid required documents/i)

    // Core assertion: the gate identifies the missing required docs.
    // Photo is exempt by canonical name; mbbs_degree_certificate is rejected
    // for not having status==="extracted"; mci_certificate / letter_hod are
    // absent. Order follows requiredDocs declaration in MEMBERSHIP_TYPES.ACM.
    expect(body.missing).toEqual(["mci_certificate", "mbbs_degree_certificate", "letter_hod"])
    expect(body.missingLabels).toEqual([
      "MCI/SMC Certificate",
      "MBBS Degree Certificate",
      "HOD Letter",
    ])

    // No side-effects: no number consumed, no member written, no application updated.
    expect(rpcFn).not.toHaveBeenCalled()
    expect(membersInsertFn).not.toHaveBeenCalled()
    expect(applicationUpdateFn).not.toHaveBeenCalled()
  })

  it("bypasses the gate when force=true (admin verified docs out of band)", async () => {
    applicationRow = KILROY_INCOMPLETE_APP

    const res = await POST(buildRequest({ applicationId: "app-kilroy-acm", force: true }))
    const body = await res.json()

    // force=true skips the gate — the request proceeds to allocate a number
    // and write a member. We're not asserting full success semantics here,
    // just that the gate did NOT short-circuit with 400.
    expect(res.status).toBe(200)
    expect(body.status).toBe(true)
    expect(rpcFn).toHaveBeenCalledTimes(1)
    expect(membersInsertFn).toHaveBeenCalledTimes(1)
    expect(applicationUpdateFn).toHaveBeenCalledTimes(1)
  })

  it("bypasses the gate on re-approval of a row that already has member_id", async () => {
    // Same incomplete docs, but member_id is set — the gate trusts the
    // original approval's validation.
    applicationRow = {
      ...KILROY_INCOMPLETE_APP,
      member_id: "member-existing-uuid",
      assigned_amasi_number: 18299,
      status: "need_clarification",
    }
    memberRow = { id: "member-existing-uuid", amasi_number: 18299 }

    const res = await POST(buildRequest({ applicationId: "app-kilroy-acm" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe(true)
    expect(body.amasiNumber).toBe(18299)
    // Idempotency path: no sequence consumed, no insert.
    expect(rpcFn).not.toHaveBeenCalled()
    expect(membersInsertFn).not.toHaveBeenCalled()
    expect(applicationUpdateFn).toHaveBeenCalledTimes(1)
  })

  it("returns 400 with an explanatory message when membership_type is unknown", async () => {
    applicationRow = { ...KILROY_INCOMPLETE_APP, membership_type: "BOGUS" }

    const res = await POST(buildRequest({ applicationId: "app-kilroy-acm" }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.status).toBe(false)
    expect(body.message).toMatch(/Unknown membership type/i)
    expect(rpcFn).not.toHaveBeenCalled()
    expect(membersInsertFn).not.toHaveBeenCalled()
    expect(applicationUpdateFn).not.toHaveBeenCalled()
  })
})

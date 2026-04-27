/**
 * Approve-route idempotency regression tests.
 *
 * Covers: application AMASI-2026-4D4FE1B70C (Dr. Puneet Agrawal) — approved
 * 2026-04-25 as AMASI #18276, later bumped to need_clarification, then
 * re-approved → 500 on email unique constraint (members.insert ran again).
 *
 * Fix: when app.member_id is non-null AND a members row exists with that id,
 * the handler skips next_amasi_number RPC and members.insert entirely, going
 * straight to the application UPDATE. See src/app/api/applications/approve/route.ts.
 *
 * See also CONTEXT.md "Application → member field copy" fragile area.
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

// ── WhatsApp mock (prevents HTTP calls; .catch() in route means no test impact) ─
vi.mock("@/lib/whatsapp", () => ({
  sendMemberApprovedWhatsApp: vi.fn(async () => undefined),
}))

// ── Sentry mock ───────────────────────────────────────────────────────────────
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────
//
// Three call shapes the handler makes:
//   1. from("membership_applications").select("*").eq(id).single()   → applicationRow
//   2. from("members").select("id, amasi_number").eq(id).maybeSingle() → memberRow
//   3. from("membership_applications").update({...}).eq(id)          → {error:null}
//   4. rpc("next_amasi_number")                                      → rpcFn (tracked)
//   5. from("members").insert({...})                                 → membersInsertFn (tracked)
//   6. from("members").delete().eq(...)                              → {error:null} (rollback)

const membersInsertFn = vi.fn(async () => ({ error: null }))
const rpcFn = vi.fn(async () => ({ data: 99999, error: null }))
let applicationRow: Record<string, unknown> | null = null
let memberRow: Record<string, unknown> | null = null
let capturedUpdateValues: Record<string, unknown> | null = null

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
          update: (values: Record<string, unknown>) => {
            capturedUpdateValues = values
            return { eq: async () => ({ error: null }) }
          },
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
      // Unknown table — fail loudly so mock gaps are visible
      throw new Error(`Unmocked Supabase table: ${table}`)
    },
    rpc: rpcFn,
  })),
}))

// Required env vars — email send is inside try-catch so absence just logs a warning
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

// Representative application row — mirrors AMASI-2026-4D4FE1B70C
const BASE_APP: Record<string, unknown> = {
  id: "app-puneet-2026",
  status: "need_clarification",
  member_id: "member-18276-uuid",
  assigned_amasi_number: 18276,
  first_name: "Puneet",
  middle_name: null,
  last_name: "Agrawal",
  name: null,
  email: "puneet@example.com",
  phone: "9876543210",
  mobile_code: "+91",
  salutation: "Dr.",
  membership_type: "LM",
  father_name: "Ram Agrawal",
  date_of_birth: "1978-05-10",
  nationality: "Indian",
  gender: "Male",
  reference_number: "AMASI-2026-4D4FE1B70C",
  application_number: null,
  street_address_1: "123 Main St",
  street_address_2: null,
  city: "Lucknow",
  state: "UP",
  country: "India",
  postal_code: "226001",
  zone: "North",
  ug_degree: "MBBS",
  ug_college: "KGMU",
  ug_university: "KGMU",
  ug_year: 2002,
  pg_degree: "MS",
  pg_college: "KGMU",
  pg_university: "KGMU",
  pg_year: 2006,
  ss_degree: null,
  mci_council_number: "MH12345",
  mci_council_state: "UP",
  imr_registration_no: null,
  asi_membership_no: "ASI-123",
  asi_state: "UP",
  documents: {
    photo: { url: "https://storage.test/photo.jpg", fileUrl: null },
    mci_certificate: { fileUrl: "https://storage.test/mci.jpg", url: null },
  },
}

beforeEach(() => {
  membersInsertFn.mockClear()
  rpcFn.mockClear()
  applicationRow = null
  memberRow = null
  capturedUpdateValues = null
})

describe("approve route idempotency (re-approval after need_clarification bump)", () => {
  it("skips members.insert and next_amasi_number RPC when application already has a linked member row", async () => {
    applicationRow = BASE_APP
    memberRow = { id: "member-18276-uuid", amasi_number: 18276 }

    const res = await POST(buildRequest({ applicationId: "app-puneet-2026", notes: "Re-approving after clarification" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe(true)
    expect(body.amasiNumber).toBe(18276)
    // Core assertion: no duplicate insert, no wasted sequence number
    expect(membersInsertFn).not.toHaveBeenCalled()
    expect(rpcFn).not.toHaveBeenCalled()
    // Application update must still happen
    expect(capturedUpdateValues).toMatchObject({ status: "approved", assigned_amasi_number: 18276 })
  })

  it("still runs full insert flow when application has no member_id (first approval)", async () => {
    applicationRow = { ...BASE_APP, member_id: null, assigned_amasi_number: null }
    memberRow = null // no existing member

    const res = await POST(buildRequest({ applicationId: "app-puneet-2026", notes: "First approval" }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe(true)
    expect(body.amasiNumber).toBe(99999) // value returned by rpcFn mock
    expect(rpcFn).toHaveBeenCalledTimes(1)
    expect(membersInsertFn).toHaveBeenCalledTimes(1)
    expect(capturedUpdateValues).toMatchObject({ status: "approved", assigned_amasi_number: 99999 })
  })
})

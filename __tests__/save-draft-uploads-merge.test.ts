/**
 * Integration test for the save-draft route's Stage B uploads merge.
 *
 * Asserts the user-requested invariant: hit the route with a populated
 * draft, then hit it again with uploads = {}, and the row's uploads must
 * be unchanged. Also covers the null-sentinel removal path and confirms
 * non-uploads step_data keys still shallow-merge as before and that
 * payment-side writes (payment_order_id, payment_id, has_verified_payment)
 * are untouched by Stage B.
 *
 * Mocking pattern mirrors __tests__/payment-document-gating.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// ── Mock supabase ───────────────────────────────────────────────────────────
// We capture every .update payload sent to draft_applications so the assertions
// can inspect what would have been written. The existing row is mutated in
// memory so a second PUT sees the first PUT's effect.

type StepData = Record<string, unknown>
type DraftRow = {
  id: string
  email: string
  step_data: StepData
  updated_at: string
  membership_type: string | null
  current_step: number
  has_verified_payment: boolean
  payment_order_id?: string | null
  payment_id?: string | null
}

let draftRow: DraftRow | null = null
let lastUpdatePayload: Record<string, unknown> | null = null

function makeFromChain(table: string) {
  // Track state across the chained calls so .update().eq().eq().select().maybeSingle()
  // returns the right thing.
  type State = {
    op: "select" | "update" | "insert" | null
    selectArg: string | null
    updatePayload: Record<string, unknown> | null
    eqFilters: Array<[string, unknown]>
  }
  const state: State = { op: null, selectArg: null, updatePayload: null, eqFilters: [] }

  const handler: ProxyHandler<object> = {
    get(_t, prop: string | symbol) {
      if (typeof prop !== "string") return undefined
      if (prop === "then") return undefined
      if (prop === "maybeSingle" || prop === "single") {
        return async () => {
          if (table === "draft_applications") {
            if (state.op === "select") {
              // .eq("email", X).limit(1).maybeSingle()
              return { data: draftRow, error: null }
            }
            if (state.op === "update") {
              // .update(payload).eq("id", X).eq("updated_at", Y).select(...).maybeSingle()
              const payload = state.updatePayload || {}
              lastUpdatePayload = payload
              // Apply the update to draftRow so subsequent calls see it.
              if (draftRow) {
                Object.assign(draftRow, payload)
                // Refresh updated_at to reflect the new write (optimistic lock advance)
                draftRow.updated_at = (payload.updated_at as string) || new Date().toISOString()
              }
              return { data: draftRow, error: null }
            }
          }
          return { data: null, error: null }
        }
      }
      return (...args: unknown[]) => {
        if (prop === "select") {
          state.op = state.op ?? "select"
          state.selectArg = (args[0] as string | null) ?? null
        } else if (prop === "update") {
          state.op = "update"
          state.updatePayload = args[0] as Record<string, unknown>
        } else if (prop === "insert") {
          state.op = "insert"
          state.updatePayload = args[0] as Record<string, unknown>
        } else if (prop === "eq") {
          state.eqFilters.push([args[0] as string, args[1]])
        }
        return new Proxy({}, handler)
      }
    },
  }
  return new Proxy({}, handler)
}

vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => makeFromChain(table),
  })),
}))

// ── Mock rate-limit ─────────────────────────────────────────────────────────
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, resetAt: Date.now() + 1000 })),
}))

// ── Mock auth — return a session matching the test email ────────────────────
vi.mock("@/lib/auth", () => ({
  getMemberSession: vi.fn(async () => ({ email: "applicant@test.local" })),
}))

// ── Mock funnel tracking — no-op ────────────────────────────────────────────
vi.mock("@/lib/funnel-tracking", () => ({
  recordStepEvent: vi.fn(async () => undefined),
}))

// ── Mock application-utils — no existing member (so the gate doesn't fire) ──
vi.mock("@/lib/application-utils", () => ({
  checkDuplicateApplication: vi.fn(async () => ({ existingMember: null, message: null })),
}))

// Required env (set before importing the route)
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.invalid"
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role"
process.env.JWT_SECRET = "test-jwt-secret-min-32-chars-aaaaaaaaaaaa"

import { PUT } from "@/app/api/applications/save-draft/route"
import type { NextRequest } from "next/server"

function buildRequest(body: Record<string, unknown>): NextRequest {
  return new Request("https://test.local/api/applications/save-draft", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

function seedDraft(uploads: Record<string, unknown>, extraStepData: Record<string, unknown> = {}) {
  draftRow = {
    id: "draft-1",
    email: "applicant@test.local",
    step_data: { uploads, ...extraStepData },
    updated_at: "2026-05-23T00:00:00.000Z",
    membership_type: "ALM",
    current_step: 3,
    has_verified_payment: false,
  }
  lastUpdatePayload = null
}

beforeEach(() => {
  draftRow = null
  lastUpdatePayload = null
})

describe("PUT /api/applications/save-draft — Stage B uploads merge integration", () => {
  it("user-requested invariant: posting uploads={} is a no-op for an existing populated row", async () => {
    seedDraft({
      profile: { status: "uploaded", fileUrl: "https://s/photo.png" },
      mci_certificate: { status: "extracted", fileUrl: "https://s/mci.pdf" },
      pg_degree_certificate: { status: "extracted", fileUrl: "https://s/pg.pdf" },
    })

    const res = await PUT(
      buildRequest({
        email: "applicant@test.local",
        current_step: 3,
        step_data: { uploads: {} },
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe(true)

    const writtenStepData = (lastUpdatePayload?.step_data ?? {}) as { uploads?: Record<string, unknown> }
    expect(writtenStepData.uploads).toEqual({
      profile: { status: "uploaded", fileUrl: "https://s/photo.png" },
      mci_certificate: { status: "extracted", fileUrl: "https://s/mci.pdf" },
      pg_degree_certificate: { status: "extracted", fileUrl: "https://s/pg.pdf" },
    })
  })

  it("refuses to clobber an existing fileUrl with null (the Stage B fix)", async () => {
    seedDraft({
      mci_certificate: { status: "extracted", fileUrl: "https://s/mci.pdf", extracted: { reg: "X" } },
    })

    await PUT(
      buildRequest({
        email: "applicant@test.local",
        current_step: 3,
        step_data: {
          uploads: {
            mci_certificate: { status: "extracted", fileUrl: null, extracted: {} },
          },
        },
      }),
    )

    const writtenStepData = (lastUpdatePayload?.step_data ?? {}) as { uploads?: Record<string, unknown> }
    const mci = (writtenStepData.uploads as Record<string, { fileUrl: string; extracted: unknown }>).mci_certificate
    expect(mci.fileUrl).toBe("https://s/mci.pdf")
    expect(mci.extracted).toEqual({ reg: "X" })
  })

  it("explicit null sentinel removes the key, other entries preserved", async () => {
    seedDraft({
      profile: { status: "uploaded", fileUrl: "https://s/photo.png" },
      mci_certificate: { status: "extracted", fileUrl: "https://s/mci.pdf" },
      pg_degree_certificate: { status: "extracted", fileUrl: "https://s/pg.pdf" },
    })

    await PUT(
      buildRequest({
        email: "applicant@test.local",
        current_step: 3,
        step_data: { uploads: { profile: null } }, // handleRemoveFile payload shape
      }),
    )

    const writtenStepData = (lastUpdatePayload?.step_data ?? {}) as { uploads?: Record<string, unknown> }
    const uploads = (writtenStepData.uploads ?? {}) as Record<string, unknown>
    expect("profile" in uploads).toBe(false)
    expect((uploads.mci_certificate as { fileUrl: string }).fileUrl).toBe("https://s/mci.pdf")
    expect((uploads.pg_degree_certificate as { fileUrl: string }).fileUrl).toBe("https://s/pg.pdf")
  })

  it("non-uploads step_data keys continue to shallow-override (formData edits propagate)", async () => {
    seedDraft(
      { mci_certificate: { status: "extracted", fileUrl: "https://s/mci.pdf" } },
      { formData: { firstName: "Old", lastName: "Name" } },
    )

    await PUT(
      buildRequest({
        email: "applicant@test.local",
        current_step: 4,
        step_data: {
          formData: { firstName: "New", lastName: "Name" }, // user edited firstName
          uploads: {}, // empty — no-op on uploads (rule 3)
        },
      }),
    )

    const writtenStepData = (lastUpdatePayload?.step_data ?? {}) as {
      uploads?: Record<string, unknown>
      formData?: { firstName?: string; lastName?: string }
    }
    // formData shallow-overrode (full replacement, just like pre-Stage-B)
    expect(writtenStepData.formData?.firstName).toBe("New")
    // uploads still preserved by rule 3
    expect((writtenStepData.uploads as Record<string, { fileUrl: string }>).mci_certificate.fileUrl).toBe(
      "https://s/mci.pdf",
    )
  })

  it("payment-side columns are written unchanged when included (Stage B did not touch this path)", async () => {
    seedDraft({ mci_certificate: { status: "extracted", fileUrl: "https://s/mci.pdf" } })

    await PUT(
      buildRequest({
        email: "applicant@test.local",
        current_step: 5,
        step_data: { uploads: {} },
        payment_order_id: "order_TEST_ABC",
        payment_id: "pay_TEST_XYZ",
      }),
    )

    expect(lastUpdatePayload?.payment_order_id).toBe("order_TEST_ABC")
    expect(lastUpdatePayload?.payment_id).toBe("pay_TEST_XYZ")
    expect(lastUpdatePayload?.has_verified_payment).toBe(true)
  })

  it("two-write sequence: first writes uploads, second posts uploads={} → row unchanged", async () => {
    // The exact pattern the user asked for: hit the route, hit again with
    // uploads={}, assert the row's uploads are unchanged.
    seedDraft({})

    // First write: populate uploads
    await PUT(
      buildRequest({
        email: "applicant@test.local",
        current_step: 3,
        step_data: {
          uploads: {
            mci_certificate: { status: "extracted", fileUrl: "https://s/mci.pdf" },
          },
        },
      }),
    )
    const firstUploads = (lastUpdatePayload?.step_data as { uploads: Record<string, unknown> } | undefined)?.uploads
    expect((firstUploads as Record<string, { fileUrl: string }>).mci_certificate.fileUrl).toBe(
      "https://s/mci.pdf",
    )

    // Second write: empty uploads — must NOT clobber the populated row
    await PUT(
      buildRequest({
        email: "applicant@test.local",
        current_step: 3,
        step_data: { uploads: {} },
      }),
    )
    const secondUploads = (lastUpdatePayload?.step_data as { uploads: Record<string, unknown> } | undefined)?.uploads
    expect((secondUploads as Record<string, { fileUrl: string }>).mci_certificate.fileUrl).toBe(
      "https://s/mci.pdf",
    )
  })
})

/**
 * Payment / document gating regression tests.
 *
 * Mirrors the create-order document gate added in the fix #4 commit.
 * The gate fetches `draft_applications.step_data.uploads` server-side and
 * requires every required-extraction doc to have a non-empty fileUrl AND
 * status === 'extracted' before any Razorpay call is made.
 *
 * Catches: any code path that lets create-order reach Razorpay without
 * passing validateRequiredDocuments — the structural bug behind the 6
 * paid-but-broken applications recorded on 2026-04-26.
 *
 * Mocks: razorpay (no real API call), createAdminClient (no real DB),
 * checkRateLimit (always allow). validateRequiredDocuments runs its real
 * implementation against the mocked draft.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// ── Razorpay mock ───────────────────────────────────────────────────────────
type OrderPayload = { amount?: number; currency?: string; [k: string]: unknown }
const ordersCreate = vi.fn(async (payload: OrderPayload) => ({
  id: "order_FAKE_TEST_123",
  amount: payload?.amount ?? 423000,
  currency: payload?.currency ?? "INR",
}))

vi.mock("razorpay", () => {
  // Razorpay is invoked with `new Razorpay(...)`, so we need a real constructable.
  class FakeRazorpay {
    orders = { create: ordersCreate }
    constructor() { /* options ignored in tests */ }
  }
  return { default: FakeRazorpay }
})

// ── Rate-limit mock — always allow ──────────────────────────────────────────
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetAt: Date.now() + 1000 })),
}))

// ── Supabase mock ───────────────────────────────────────────────────────────
// The create-order route runs three queries:
//   1. draft_applications.select("step_data")...        → returns draftRow (or null)
//   2. draft_applications.select("id, current_step")... → returns null (no paid draft)
//   3. membership_applications.select(...)...           → returns null (no existing app)
// We dispatch by `.select(arg)` to keep the mock concise.
type UploadEntry = { status: string; extracted: Record<string, unknown>; fileUrl: string | null; message?: string }
type DraftRow = { id: string; step_data: { uploads: Record<string, UploadEntry> } }
let draftRow: DraftRow | null = null

function makeChainable(resolveFn: (selectArg: string | null) => unknown) {
  let selectArg: string | null = null
  const handler: ProxyHandler<object> = {
    get(_target, prop: string | symbol) {
      if (typeof prop !== "string") return undefined
      if (prop === "then") return undefined // not a Promise
      if (prop === "maybeSingle" || prop === "single") {
        return async () => ({ data: resolveFn(selectArg), error: null })
      }
      return (...args: unknown[]) => {
        if (prop === "select") selectArg = (args[0] as string | null) ?? null
        return new Proxy({}, handler)
      }
    },
  }
  return new Proxy({}, handler)
}

vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "draft_applications") {
        return makeChainable((selectArg) => {
          if (selectArg === "step_data") return draftRow
          // duplicate-payment guard (selectArg === "id, current_step")
          return null
        })
      }
      if (table === "membership_applications") {
        // existingApp guard
        return makeChainable(() => null)
      }
      throw new Error(`Unmocked table: ${table}`)
    },
  })),
}))

// Required env vars must be set BEFORE importing the route under test.
process.env.RAZORPAY_KEY_ID = "rzp_test_key"
process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret"

// Import the route AFTER mocks are wired
import { POST } from "@/app/api/payments/create-order/route"
import type { NextRequest } from "next/server"

function buildRequest(body: Record<string, unknown>): NextRequest {
  return new Request("https://test.local/api/payments/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest
}

const baseBody = {
  amount: 4230,
  currency: "INR",
  referenceNumber: "AMASI-TEST-0001",
  email: "test@amasi.org",
  name: "Dr Test",
  membershipType: "ALM", // requires mci_certificate + pg_degree_certificate (+ photo, which the validator skips)
}

const validUpload = {
  status: "extracted",
  extracted: { name: "Dr Test", registration_number: "MH12345" },
  fileUrl: "https://storage.test/uploads/mci/123.jpg",
  message: undefined,
}

beforeEach(() => {
  ordersCreate.mockClear()
  draftRow = null
})

describe("create-order document gating", () => {
  it("creates a Razorpay order when every required doc has fileUrl + status='extracted'", async () => {
    draftRow = {
      id: "draft-1",
      step_data: {
        uploads: {
          mci_certificate: validUpload,
          pg_degree_certificate: validUpload,
        },
      },
    }
    const res = await POST(buildRequest(baseBody))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ status: true, orderId: "order_FAKE_TEST_123" })
    expect(ordersCreate).toHaveBeenCalledTimes(1)
  })

  it("returns 400 'documents_incomplete' when a required doc has fileUrl=null and does NOT call Razorpay", async () => {
    draftRow = {
      id: "draft-2",
      step_data: {
        uploads: {
          mci_certificate: { ...validUpload, fileUrl: null },
          pg_degree_certificate: validUpload,
        },
      },
    }
    const res = await POST(buildRequest(baseBody))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe("documents_incomplete")
    expect(body.missing).toContain("mci_certificate")
    expect(ordersCreate).not.toHaveBeenCalled()
  })

  it("returns 400 'documents_incomplete' when a required doc has status='rejected' and does NOT call Razorpay", async () => {
    draftRow = {
      id: "draft-3",
      step_data: {
        uploads: {
          mci_certificate: { ...validUpload, status: "rejected" },
          pg_degree_certificate: validUpload,
        },
      },
    }
    const res = await POST(buildRequest(baseBody))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe("documents_incomplete")
    expect(body.missing).toContain("mci_certificate")
    expect(ordersCreate).not.toHaveBeenCalled()
  })

  it("creates the order when an OPTIONAL (non-required) doc is missing — does not over-block", async () => {
    // ALM requires mci_certificate + pg_degree_certificate.
    // asi_member_certificate is NOT required for ALM (it's required for LM).
    // Its absence here should not gate payment.
    draftRow = {
      id: "draft-4",
      step_data: {
        uploads: {
          mci_certificate: validUpload,
          pg_degree_certificate: validUpload,
          // asi_member_certificate intentionally absent
        },
      },
    }
    const res = await POST(buildRequest(baseBody))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe(true)
    expect(ordersCreate).toHaveBeenCalledTimes(1)
  })

  it("returns 400 when no draft exists for the email yet (uploads server-side state must precede payment)", async () => {
    draftRow = null
    const res = await POST(buildRequest(baseBody))
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toBe("documents_incomplete")
    expect(ordersCreate).not.toHaveBeenCalled()
  })
})

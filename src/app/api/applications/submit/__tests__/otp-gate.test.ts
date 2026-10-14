import { describe, it, expect, vi, beforeEach } from "vitest"

// The OTP gate on submit. A long form means applicants often pay with an OTP
// older than the 2-hour window; a captured payment must still go through when
// the payer verified this same email shortly before paying.

type Filter = { op: string; col: string; val: unknown }
type Otp = { email: string; verified: boolean; created_at: string }

const NOW = new Date("2026-10-10T15:05:30Z")
const PAID_AT = "2026-10-10T15:05:11Z"
let payment: { id: string; status: string; member_email: string; created_at: string } | null
let otps: Otp[]

function matches(row: Record<string, unknown>, filters: Filter[]) {
  return filters.every(({ op, col, val }) => {
    const v = row[col]
    if (op === "eq") return v === val
    if (op === "gte") return String(v) >= String(val)
    if (op === "lte") return String(v) <= String(val)
    return true
  })
}

function table(name: string) {
  const filters: Filter[] = []
  const q = {
    select: () => q,
    eq: (col: string, val: unknown) => (filters.push({ op: "eq", col, val }), q),
    gte: (col: string, val: unknown) => (filters.push({ op: "gte", col, val }), q),
    lte: (col: string, val: unknown) => (filters.push({ op: "lte", col, val }), q),
    limit: () => q,
    maybeSingle: async () => {
      if (name === "membership_payments") {
        return { data: payment && matches({ ...payment, gateway_payment_id: "pay_1" }, filters) ? payment : null }
      }
      if (name === "otp_codes") {
        const rows = otps.map((o) => ({ ...o, created_at: new Date(o.created_at).toISOString() }))
        return { data: rows.find((o) => matches(o, filters)) ?? null }
      }
      return { data: null }
    },
  }
  return q
}

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createAdminClient: () => ({ from: table }) }))
vi.mock("@/lib/ai-approval", () => ({ scoreApplication: vi.fn() }))
vi.mock("@/lib/funnel-tracking", () => ({ recordStepEvent: vi.fn() }))
vi.mock("@/lib/whatsapp", () => ({ sendApplicationSubmittedWhatsApp: vi.fn() }))
vi.mock("@/lib/auto-approval", () => ({ autoApproveApplication: vi.fn() }))
vi.mock("@/lib/ai-decision-log", () => ({ logAiDecision: vi.fn(), updateAiDecisionOutcome: vi.fn() }))
// Stop right after the OTP gate: a 400 "documents" answer means the gate let
// the request through, a 401 means it refused.
vi.mock("@/lib/membership-types", () => ({ getMembershipType: () => ({ requiredDocs: ["x"] }) }))
vi.mock("@/lib/document-keys", () => ({
  validateRequiredDocuments: () => ({ valid: false, reason: "missing", missing: ["x"], bypassedDocs: [] }),
  lookupDocumentLabel: (k: string) => k,
  formatManualReviewReason: vi.fn(),
}))

async function submit(email = "Doc@Example.com") {
  const { POST } = await import("../route")
  const req = new Request("http://localhost/api/applications/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ formData: { email, membershipType: "life" }, referenceNumber: "AMASI-1", paymentId: "pay_1", uploads: {} }),
  })
  return POST(req as never)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  payment = { id: "p1", status: "paid", member_email: "doc@example.com", created_at: PAID_AT }
  otps = []
})

describe("submit OTP gate", () => {
  it("accepts an OTP verified within the last 2 hours", async () => {
    otps = [{ email: "doc@example.com", verified: true, created_at: "2026-10-10T14:30:00Z" }]
    expect((await submit()).status).toBe(400)
  })

  it("accepts a paid applicant whose OTP went stale while filling the form", async () => {
    // Kalesha's case: OTP at 09:29, paid at 15:05.
    otps = [{ email: "doc@example.com", verified: true, created_at: "2026-10-10T09:29:32Z" }]
    expect((await submit()).status).toBe(400)
  })

  it("refuses when the payment was made under a different email", async () => {
    payment!.member_email = "someone-else@example.com"
    otps = [{ email: "doc@example.com", verified: true, created_at: "2026-10-10T09:29:32Z" }]
    expect((await submit()).status).toBe(401)
  })

  it("refuses an OTP verified more than 24 hours before the payment", async () => {
    otps = [{ email: "doc@example.com", verified: true, created_at: "2026-10-09T15:00:00Z" }]
    expect((await submit()).status).toBe(401)
  })

  it("refuses an OTP that was never verified", async () => {
    otps = [{ email: "doc@example.com", verified: false, created_at: "2026-10-10T14:30:00Z" }]
    expect((await submit()).status).toBe(401)
  })

  it("refuses when there is no paid payment", async () => {
    payment = null
    otps = [{ email: "doc@example.com", verified: true, created_at: "2026-10-10T14:30:00Z" }]
    expect((await submit()).status).toBe(401)
  })
})

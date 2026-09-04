import { describe, it, expect, vi, beforeEach } from "vitest"

// Hoisted so the mock factory below and the tests can share the same
// function reference — needed to override the upload/event-insert outcome
// per-test (default success; individual tests override with mockResolvedValueOnce).
const { uploadMock, eventSingleMock, eventInsertMock } = vi.hoisted(() => ({
  uploadMock: vi.fn().mockResolvedValue({ data: { path: "x" }, error: null }),
  eventSingleMock: vi.fn().mockResolvedValue({ data: { id: "evt-1" }, error: null }),
  eventInsertMock: vi.fn(),
}))
eventInsertMock.mockImplementation(() => ({ select: () => ({ single: eventSingleMock }) }))

vi.mock("@/lib/mou/approval-token", () => ({
  verifyApprovalToken: vi.fn(),
  markTokenUsed: vi.fn(),
}))
vi.mock("@/lib/mou/supabase-helpers", () => ({
  getApplicationById: vi.fn(),
  updateApplicationStatus: vi.fn(),
  createRemark: vi.fn(),
}))
vi.mock("@/lib/mou/mou-pdf", () => ({ generateMouPdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-fake")) }))
vi.mock("@/lib/mou/notify", () => ({ sendOutcomeEmail: vi.fn(), sendWhatsAppNudge: vi.fn() }))
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))
vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    storage: {
      from: () => ({
        upload: uploadMock,
        getPublicUrl: () => ({ data: { publicUrl: "https://example.com/mou.pdf" } }),
      }),
    },
    from: (table: string) => {
      if (table === "events") return { insert: eventInsertMock }
      throw new Error(`unexpected table in test mock: ${table}`)
    },
  }),
}))

import { POST as decidePOST } from "@/app/api/mou/review/[token]/decide/route"
import { verifyApprovalToken, markTokenUsed } from "@/lib/mou/approval-token"
import { getApplicationById, updateApplicationStatus } from "@/lib/mou/supabase-helpers"
import { sendOutcomeEmail } from "@/lib/mou/notify"
import * as Sentry from "@sentry/nextjs"

const decidableToken = { ok: true as const, row: { id: "t1", application_id: "app-1", role: "hon_secretary", can_decide: true } }
const baseApplication = {
  id: "app-1", application_type_id: "fmas", organizer_name: "Dr. Test", email: "o@example.com",
  phone_number: "9999999999", mou_version: 0,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

describe("POST /api/mou/review/[token]/decide", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects an invalid token", async () => {
    vi.mocked(verifyApprovalToken).mockResolvedValue({ ok: false, message: "invalid" })
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ action: "approved" }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await decidePOST(req as any, { params: Promise.resolve({ token: "bad" }) })
    expect(res.status).toBe(400)
  })

  it("rejects a token without decide permission", async () => {
    vi.mocked(verifyApprovalToken).mockResolvedValue({ ok: true, row: { id: "t1", application_id: "app-1", role: "president", can_decide: false } })
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ action: "approved" }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await decidePOST(req as any, { params: Promise.resolve({ token: "raw" }) })
    expect(res.status).toBe(403)
  })

  it("approves and updates the application status when the token can decide", async () => {
    vi.mocked(verifyApprovalToken).mockResolvedValue({ ok: true, row: { id: "t1", application_id: "app-1", role: "hon_secretary", can_decide: true } })
    vi.mocked(getApplicationById).mockResolvedValue({
      id: "app-1", application_type_id: "fmas", organizer_name: "Dr. Test", email: "o@example.com",
      phone_number: "9999999999", mou_version: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ action: "approved" }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await decidePOST(req as any, { params: Promise.resolve({ token: "raw" }) })
    expect(res.status).toBe(200)
    expect(updateApplicationStatus).toHaveBeenCalledWith("app-1", "approved", expect.objectContaining({ reviewed_by: "hon_secretary" }))
  })

  it("returns 500 and does not persist or burn the token when the MOU upload fails", async () => {
    vi.mocked(verifyApprovalToken).mockResolvedValue(decidableToken)
    vi.mocked(getApplicationById).mockResolvedValue(baseApplication)
    uploadMock.mockResolvedValueOnce({ data: null, error: { message: "storage down" } })

    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ action: "approved" }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await decidePOST(req as any, { params: Promise.resolve({ token: "raw" }) })

    expect(res.status).toBe(500)
    expect(updateApplicationStatus).not.toHaveBeenCalled()
    expect(markTokenUsed).not.toHaveBeenCalled()
  })

  it("returns 500 and does not burn the token when persisting the decision throws", async () => {
    vi.mocked(verifyApprovalToken).mockResolvedValue(decidableToken)
    vi.mocked(getApplicationById).mockResolvedValue(baseApplication)
    vi.mocked(updateApplicationStatus).mockRejectedValueOnce(new Error("db unreachable"))

    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ action: "rejected", notes: "not eligible" }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await decidePOST(req as any, { params: Promise.resolve({ token: "raw" }) })

    expect(res.status).toBe(500)
    expect(markTokenUsed).not.toHaveBeenCalled()
  })

  it("passes the actual notes text (not the stale pre-update application object) to sendOutcomeEmail on rejection", async () => {
    vi.mocked(verifyApprovalToken).mockResolvedValue(decidableToken)
    // Deliberately stale: rejection_reason on the fetched application is
    // null (as it always is — the object is fetched before the DB write),
    // simulating the real bug scenario.
    vi.mocked(getApplicationById).mockResolvedValue({ ...baseApplication, rejection_reason: null })

    const req = new Request("http://test", {
      method: "POST",
      body: JSON.stringify({ action: "rejected", notes: "does not meet eligibility criteria" }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await decidePOST(req as any, { params: Promise.resolve({ token: "raw" }) })

    expect(res.status).toBe(200)
    expect(sendOutcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "app-1" }),
      "FMAS Course",
      "rejected",
      "does not meet eligibility criteria",
      undefined,
    )
  })

  it("creates an event in the shared events table and links it via created_event_id on approval", async () => {
    vi.mocked(verifyApprovalToken).mockResolvedValue(decidableToken)
    vi.mocked(getApplicationById).mockResolvedValue({
      ...baseApplication,
      primary_institution: "Test Institute",
      preferred_date_1: "2027-03-10",
      venue_name: "Main Hall",
      venue_city: "Chennai",
      venue_state: "Tamil Nadu",
      venue_country: "India",
    })
    eventSingleMock.mockResolvedValueOnce({ data: { id: "evt-42" }, error: null })

    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ action: "approved" }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await decidePOST(req as any, { params: Promise.resolve({ token: "raw" }) })

    expect(res.status).toBe(200)
    expect(eventInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        venue_name: "Main Hall",
        city: "Chennai",
        state: "Tamil Nadu",
        country: "India",
        start_date: "2027-03-10",
        end_date: "2027-03-10",
        slug: expect.any(String),
      }),
    )
    expect(updateApplicationStatus).toHaveBeenCalledWith(
      "app-1",
      "approved",
      expect.objectContaining({ created_event_id: "evt-42" }),
    )
  })

  it("still approves (and does not throw) when the event auto-create insert fails", async () => {
    vi.mocked(verifyApprovalToken).mockResolvedValue(decidableToken)
    vi.mocked(getApplicationById).mockResolvedValue(baseApplication)
    eventSingleMock.mockResolvedValueOnce({ data: null, error: { message: "column \"venue_name\" does not exist" } })

    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ action: "approved" }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await decidePOST(req as any, { params: Promise.resolve({ token: "raw" }) })

    expect(res.status).toBe(200)
    expect(markTokenUsed).toHaveBeenCalled()
    const call = vi.mocked(updateApplicationStatus).mock.calls[0]
    expect(call[2]).not.toHaveProperty("created_event_id")
    expect(Sentry.captureException).toHaveBeenCalled()
  })
})

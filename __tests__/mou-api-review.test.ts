import { describe, it, expect, vi, beforeEach } from "vitest"

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
vi.mock("@/lib/supabase", () => ({ createAdminClient: () => ({ storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "x" }, error: null }), getPublicUrl: () => ({ data: { publicUrl: "https://example.com/mou.pdf" } }) }) } }) }))

import { POST as decidePOST } from "@/app/api/mou/review/[token]/decide/route"
import { verifyApprovalToken } from "@/lib/mou/approval-token"
import { getApplicationById, updateApplicationStatus } from "@/lib/mou/supabase-helpers"

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
})

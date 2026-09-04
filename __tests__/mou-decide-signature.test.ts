// __tests__/mou-decide-signature.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/mou/approval-token", () => ({
  verifyApprovalToken: vi.fn().mockResolvedValue({ ok: true, row: { application_id: "app-1", role: "hon_secretary", can_decide: true } }),
  markTokenUsed: vi.fn(),
}))
vi.mock("@/lib/mou/supabase-helpers", () => ({
  getApplicationById: vi.fn().mockResolvedValue({
    id: "app-1", application_type_id: "rural_program", organizer_name: "Dr. Test",
    email: "test@example.com", phone_number: "9999999999", mou_version: 0,
    otp_verified_at: "2026-09-04T00:00:00.000Z", reviewed_by: null, reviewed_at: null,
  }),
  updateApplicationStatus: vi.fn().mockResolvedValue(undefined),
}))
// event-type-config.ts imports RURAL_PROGRAM_CLAUSES/WORKSHOP_CLAUSES from
// this module (see __tests__/mou-api-review.test.ts for the same established
// pattern) — a full-replacement mock without them breaks module resolution
// at load time, unrelated to markCounterSigned.
vi.mock("@/lib/mou/mou-pdf", () => ({
  generateMouPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
  RURAL_PROGRAM_CLAUSES: [],
  WORKSHOP_CLAUSES: [],
}))
vi.mock("@/lib/mou/notify", () => ({ sendOutcomeEmail: vi.fn(), sendWhatsAppNudge: vi.fn() }))
vi.mock("@/lib/mou/mou-signature", () => ({ markCounterSigned: vi.fn() }))
// `from()` needs to serve two different chains depending on table: the
// "events" auto-create insert (insert().select().single()) and, for
// mou-framework types, the mou_signatures counter-signature lookup
// (select().eq().eq().maybeSingle()) added by Task 9. The literal brief
// snippet only covered the insert chain — extended here to unblock the
// signature-lookup Step 6 adds, since this file is local to this task.
vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "https://x/mou.pdf" } }) }) },
    from: () => ({
      insert: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: "event-1" }, error: null }) }) }),
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) }),
    }),
  }),
}))

import { POST } from "@/app/api/mou/review/[token]/decide/route"
import { markCounterSigned } from "@/lib/mou/mou-signature"
import { EVENT_TYPE_CONFIG, isMouEventTypeConfig } from "@/lib/mou/event-type-config"

describe("POST /api/mou/review/[token]/decide — signature counter-signing", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls markCounterSigned with the application's mou-framework typeConfig version on approval", async () => {
    const rural = EVENT_TYPE_CONFIG.rural_program
    if (!isMouEventTypeConfig(rural)) throw new Error("rural_program must be MouEventTypeConfig")
    const req = new Request("http://test/decide", { method: "POST", body: JSON.stringify({ action: "approved" }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, { params: Promise.resolve({ token: "raw-token" }) })
    expect(res.status).toBe(200)
    expect(markCounterSigned).toHaveBeenCalledWith("app-1", rural.mouVersion, "hon_secretary")
  })

  it("does not call markCounterSigned when the action is rejected", async () => {
    const req = new Request("http://test/decide", { method: "POST", body: JSON.stringify({ action: "rejected", notes: "no" }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, { params: Promise.resolve({ token: "raw-token" }) })
    expect(res.status).toBe(200)
    expect(markCounterSigned).not.toHaveBeenCalled()
  })
})

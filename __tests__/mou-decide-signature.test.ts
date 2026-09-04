// __tests__/mou-decide-signature.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// Regression guard for the exact bug this task exists to prevent: the
// mou_signatures select must run AFTER markCounterSigned, not before. A
// mock that always returns the same maybeSingle() payload regardless of
// call order wouldn't catch a regression that swaps the two back to the
// broken order. Instead, this flag makes the select's return value
// STATEFUL, flipping to the post-counter-sign shape only once
// markCounterSigned has actually run — so if the ordering regresses, the
// select observes the flag still false and generateMouPdf gets a
// pre-counter-sign (approved_by: null) record, which the assertion below
// catches.
const { counterSignedFlag } = vi.hoisted(() => ({ counterSignedFlag: { value: false } }))

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
vi.mock("@/lib/mou/mou-signature", () => ({
  markCounterSigned: vi.fn().mockImplementation(async () => {
    counterSignedFlag.value = true
  }),
}))
// `from()` needs to serve two different chains depending on table: the
// "events" auto-create insert (insert().select().single()) and, for
// mou-framework types, the mou_signatures counter-signature lookup — now
// select().eq().order().limit().maybeSingle() (Fix 3: find the actual
// signed row regardless of the current config's mouVersion, rather than
// .eq("mou_version", typeConfig.mouVersion), which would make an
// application signed under an older version permanently unfindable once
// the config's version is bumped). maybeSingle()'s payload is keyed off
// counterSignedFlag (see above) so the test can actually detect an
// ordering regression, not just that markCounterSigned was called at some
// point during the request.
vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "https://x/mou.pdf" } }) }) },
    from: () => ({
      insert: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: "event-1" }, error: null }) }) }),
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: vi.fn().mockImplementation(async () => ({
                data: {
                  id: "sig-1", application_id: "app-1", mou_version: 1, mou_sha256: "a".repeat(64),
                  signatory_name: "Dr. Test", signatory_email: "test@example.com", signatory_amasi_number: null,
                  otp_verified_at: "2026-09-04T00:00:00.000Z", accepted_at: "2026-09-04T00:00:00.000Z",
                  ip_address: "127.0.0.1", user_agent: null, created_at: "2026-09-04T00:00:00.000Z",
                  approved_by: counterSignedFlag.value ? "hon_secretary" : null,
                  approved_at: counterSignedFlag.value ? "2026-09-04T01:00:00.000Z" : null,
                },
                error: null,
              })),
            }),
          }),
        }),
      }),
    }),
  }),
}))

import { POST } from "@/app/api/mou/review/[token]/decide/route"
import { markCounterSigned } from "@/lib/mou/mou-signature"
import { generateMouPdf } from "@/lib/mou/mou-pdf"
import { EVENT_TYPE_CONFIG, isMouEventTypeConfig } from "@/lib/mou/event-type-config"

describe("POST /api/mou/review/[token]/decide — signature counter-signing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    counterSignedFlag.value = false
  })

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

  it("passes generateMouPdf a POST-counter-sign signature record — fails if the ordering regresses", async () => {
    const req = new Request("http://test/decide", { method: "POST", body: JSON.stringify({ action: "approved" }) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any, { params: Promise.resolve({ token: "raw-token" }) })
    expect(res.status).toBe(200)
    // If markCounterSigned ran AFTER (or the select ran BEFORE it), the
    // select above would have observed counterSignedFlag.value === false
    // and generateMouPdf would receive approved_by: null instead.
    expect(generateMouPdf).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ approved_by: "hon_secretary", approved_at: "2026-09-04T01:00:00.000Z" })
    )
  })
})

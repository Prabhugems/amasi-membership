/**
 * Tests for runCleanupDrafts() (src/lib/cleanup-drafts.ts), extracted from
 * the route 2026-08-20 specifically so this coverage could exist.
 *
 * Scope (the highest-risk new behavior, not full 8-step coverage — see
 * conversation/CONTEXT.md for the acknowledged gap on Step 4/4b/5 paths
 * which involve the Razorpay SDK and admin-alert emails):
 *
 *   - Step 3  hard-delete of an eligible unpaid draft: delete called,
 *     storage cleanup called with its paths, audit logged, cancellation
 *     email sent, summary.hard_deleted incremented.
 *   - Payment safety guard: a draft that LOOKS unpaid on its own columns
 *     but has a real captured payment in membership_payments (isPaidNoApp)
 *     must NEVER be deleted.
 *   - Step 3a silent delete (no formData, OTP-only): deleted, NO email sent.
 *   - Race guard: the conditional delete's WHERE clause matches nothing
 *     (payment arrived mid-run) → skipped, no storage/audit/email/counter.
 *   - Excluded test address: still deleted for real, but no email sent.
 *   - dryRun: no delete, no email, no storage removal — only a planned
 *     action recorded.
 *
 * Mock strategy for draft_applications: the six SELECT queries this job
 * issues against it happen in a fixed, known order per run (Step 1, 1b, 2,
 * 3a, 3, 4, [4b if paidNoAppEmails non-empty], 5) — tests keep
 * paidNoAppEmails empty (membership_payments returns []) so 4b never fires,
 * leaving exactly 6 draft_applications selects. A queue is shifted once per
 * select call. Mutations (update/delete) are resolved by looking up the id
 * passed to .eq("id", ...) in a per-test result map — default succeeds.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

// vi.mock factories are hoisted above every other top-level statement,
// including plain `const`/`let` — anything they reference has to be
// declared through vi.hoisted() or it's a TDZ error at import time.
const state = vi.hoisted(() => ({
  sendMock: vi.fn(async (args: { to: string; [key: string]: unknown }) => ({ data: { id: "email_test_id", to: args.to }, error: null })),
  auditMock: vi.fn(async () => undefined),
  removeMock: vi.fn(async (paths: string[]) => ({ error: null, removedCount: paths.length })),
  // draft_applications SELECT queue (shifted once per .select() call)
  draftSelectQueue: [] as unknown[][],
  // mutation result maps, keyed by the id passed to .eq("id", X)
  deleteResults: new Map<string, { id: string; step_data?: Record<string, unknown> } | null>(),
  updateSelectResults: new Map<string, { id: string } | null>(),
  // other tables
  paidRows: [] as { member_email: string }[],
  existingApps: [] as { email: string; status: string }[],
  existingMembers: [] as { email: string }[],
  adminUsers: [] as { email: string }[],
}))
const { sendMock, auditMock, removeMock } = state

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: state.sendMock }
  },
}))

vi.mock("@/lib/audit-log", () => ({
  logMembershipAuditEvent: state.auditMock,
}))

function chainable(resolve: () => unknown) {
  const builder: Record<string, unknown> = {}
  const methods = ["select", "update", "insert", "eq", "in", "is", "not", "lt", "lte", "or", "order"]
  for (const m of methods) {
    builder[m] = () => builder
  }
  builder.delete = () => builder
  builder.maybeSingle = async () => resolve()
  builder.single = async () => resolve()
  builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled, onRejected)
  return builder
}

vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "membership_payments") {
        return chainable(() => ({ data: state.paidRows, error: null }))
      }
      if (table === "membership_applications") {
        return chainable(() => ({ data: state.existingApps, error: null }))
      }
      if (table === "members") {
        return chainable(() => ({ data: state.existingMembers, error: null }))
      }
      if (table === "admin_users") {
        return chainable(() => ({ data: state.adminUsers, error: null }))
      }
      if (table === "draft_applications") {
        // A single chain object handles select, update, and delete calls.
        // We can't know in advance which verb this particular chain is until
        // it resolves — track what was called on THIS chain instance.
        let isDelete = false
        let isUpdate = false
        let hasSelectAfterMutation = false
        let capturedId: string | null = null
        const b: Record<string, unknown> = {}
        b.select = () => {
          if (isDelete || isUpdate) hasSelectAfterMutation = true
          return b
        }
        b.update = () => { isUpdate = true; return b }
        b.delete = () => { isDelete = true; return b }
        b.eq = (col: string, val: unknown) => {
          if (col === "id") capturedId = val as string
          return b
        }
        b.in = () => b
        b.is = () => b
        b.not = () => b
        b.lt = () => b
        b.lte = () => b
        b.or = () => b
        const resolveMutation = () => {
          if (isDelete) {
            const row = capturedId ? state.deleteResults.get(capturedId) : undefined
            return { data: row === undefined ? null : row, error: null }
          }
          // update
          if (hasSelectAfterMutation) {
            const row = capturedId ? state.updateSelectResults.get(capturedId) : undefined
            return { data: row === undefined ? { id: capturedId } : row, error: null }
          }
          return { error: null }
        }
        b.maybeSingle = async () => resolveMutation()
        b.single = async () => resolveMutation()
        b.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
          if (isDelete || isUpdate) {
            return Promise.resolve(resolveMutation()).then(onFulfilled, onRejected)
          }
          // Pure select — pull the next queued response.
          const data = state.draftSelectQueue.shift() ?? []
          return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
        }
        return b
      }
      throw new Error(`Unmocked Supabase table in test: ${table}`)
    },
    storage: {
      from: () => ({ remove: removeMock }),
    },
  })),
}))

process.env.RESEND_API_KEY = "test_resend_key_not_real"
process.env.NEXT_PUBLIC_APP_URL = "https://membership.test"

import { runCleanupDrafts } from "@/lib/cleanup-drafts"

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft-1",
    email: "applicant@example.com",
    phone: null,
    current_step: 4,
    status: "stuck",
    updated_at: new Date(Date.now() - 30 * 3600000).toISOString(), // 30h idle
    created_at: new Date(Date.now() - 40 * 3600000).toISOString(),
    payment_order_id: null,
    payment_id: null,
    has_verified_payment: false,
    reminder_sent_at: new Date(Date.now() - 10 * 3600000).toISOString(), // sent 10h ago (>6h grace)
    step_data: { formData: { email: "applicant@example.com" }, uploads: { profile: { status: "uploaded", fileUrl: "photo/abc.jpg" } } },
    ...overrides,
  }
}

/** Queue: [Step1, Step1b, Step2, Step3a, Step3, Step4, Step5] all empty by default. */
function emptySixSelects(): unknown[][] {
  return [[], [], [], [], [], [], []]
}

beforeEach(() => {
  sendMock.mockClear()
  auditMock.mockClear()
  removeMock.mockClear()
  state.draftSelectQueue = emptySixSelects()
  state.deleteResults = new Map()
  state.updateSelectResults = new Map()
  state.paidRows = []
  state.existingApps = []
  state.existingMembers = []
  state.adminUsers = []
})

describe("runCleanupDrafts — Step 3 hard-delete (unpaid, 24h idle, has formData)", () => {
  it("deletes the row, cleans up storage, logs the audit event, sends the cancellation email, increments hard_deleted", async () => {
    const draft = draftRow()
    const queue = emptySixSelects()
    queue[4] = [draft] // Step 3's select slot
    state.draftSelectQueue = queue
    state.deleteResults.set(draft.id, { id: draft.id, step_data: draft.step_data })

    const summary = await runCleanupDrafts({ dryRun: false })

    expect(summary.hard_deleted).toBe(1)
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(removeMock.mock.calls[0][0]).toEqual(["photo/abc.jpg"])
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "draft_hard_deleted_unpaid", entityId: draft.id }),
      expect.anything(),
    )
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({
      to: draft.email,
      subject: "Your AMASI membership application has been cancelled",
    })
  })

  it("never deletes a draft with a real captured payment (isPaidNoApp), even though its own columns look unpaid", async () => {
    const draft = draftRow({ email: "secretly-paid@example.com" })
    const queue = emptySixSelects()
    queue[4] = [draft]
    state.draftSelectQueue = queue
    // membership_payments has a paid row for this email, and no application/member exists yet.
    state.paidRows = [{ member_email: "secretly-paid@example.com" }]
    state.deleteResults.set(draft.id, { id: draft.id, step_data: draft.step_data }) // would succeed if attempted

    const summary = await runCleanupDrafts({ dryRun: false })

    expect(summary.hard_deleted).toBe(0)
    expect(removeMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ entityId: draft.id }),
      expect.anything(),
    )
  })

  it("respects the race guard — if the conditional delete matches no row (payment arrived mid-run), it's skipped entirely", async () => {
    const draft = draftRow()
    const queue = emptySixSelects()
    queue[4] = [draft]
    state.draftSelectQueue = queue
    // Deliberately do NOT register a state.deleteResults entry — lookup returns
    // undefined → the mock resolves { data: null }, same as Supabase
    // returning 0 rows for the WHERE clause.

    const summary = await runCleanupDrafts({ dryRun: false })

    expect(summary.hard_deleted).toBe(0)
    expect(removeMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("test/internal addresses are still deleted for real, but never emailed", async () => {
    const draft = draftRow({ email: "test@example.com" })
    const queue = emptySixSelects()
    queue[4] = [draft]
    state.draftSelectQueue = queue
    state.deleteResults.set(draft.id, { id: draft.id, step_data: draft.step_data })

    const summary = await runCleanupDrafts({ dryRun: false })

    expect(summary.hard_deleted).toBe(1)
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it("dryRun: true — no delete, no email, no storage removal; records a planned action instead", async () => {
    const draft = draftRow()
    const queue = emptySixSelects()
    queue[4] = [draft]
    state.draftSelectQueue = queue
    state.deleteResults.set(draft.id, { id: draft.id, step_data: draft.step_data })

    const summary = await runCleanupDrafts({ dryRun: true })

    expect(summary.hard_deleted).toBe(0)
    expect(removeMock).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
    const planned = summary.would_act_on.find((a) => a.id === draft.id)
    expect(planned?.would_do).toBe("hard_delete_unpaid")
  })
})

describe("runCleanupDrafts — Step 3a silent delete (OTP-only, no formData)", () => {
  it("deletes silently — no email is ever sent for this branch", async () => {
    const draft = draftRow({ step_data: {} }) // no formData at all
    const queue = emptySixSelects()
    queue[3] = [draft] // Step 3a's select slot
    state.draftSelectQueue = queue
    state.deleteResults.set(draft.id, { id: draft.id, step_data: draft.step_data })

    const summary = await runCleanupDrafts({ dryRun: false })

    expect(summary.hard_deleted).toBe(1)
    expect(sendMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "draft_hard_deleted_no_formdata", entityId: draft.id }),
      expect.anything(),
    )
  })

  it("payment guard applies here too — a paid OTP-only draft is never silently deleted", async () => {
    const draft = draftRow({ step_data: {}, email: "paid-otp-only@example.com" })
    const queue = emptySixSelects()
    queue[3] = [draft]
    state.draftSelectQueue = queue
    state.paidRows = [{ member_email: "paid-otp-only@example.com" }]
    state.deleteResults.set(draft.id, { id: draft.id, step_data: draft.step_data })

    const summary = await runCleanupDrafts({ dryRun: false })

    expect(summary.hard_deleted).toBe(0)
    expect(removeMock).not.toHaveBeenCalled()
  })
})

# Draft Rescue: Complete & Submit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a one-click "Complete & Submit" action for `payment_on_hold` drafts (applicant paid but never finished submitting), reusing the exact reconstruction logic `/api/admin/orphan-payments/promote` already has, instead of leaving these applicants stuck with no recovery path but a self-service email.

**Architecture:** Extract the draft-reconstruction logic already living inside `orphan-payments/promote/route.ts` into a shared function, `promoteDraftToApplication()`. Rewire that route to call it. Add one new route that loads a `payment_on_hold` draft directly and calls the same function. Add one button + confirm dialog to the existing `/incomplete` admin page. No new admin page, no schema changes.

**Tech Stack:** Next.js 16 App Router route handlers, Supabase (service-role admin client), TanStack Query mutations, shadcn `ConfirmDialog`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-draft-rescue-design.md` — this plan implements that spec exactly, including the fixes from both review rounds (the `.is("application_id", null)` payment-lookup guard, the link-failure/soft-complete ordering, the `LINK_FAILED` audit-log fix, and the `rejected` duplicate-check exclusion). Read the spec's §1 before Task 1 and §2 before Task 3 — this plan doesn't repeat the "why," only the "what."

## Global Constraints

- All DB access goes through `createAdminClient()` (service-role) — never introduce a browser-side Supabase client (`.claude/CONTEXT.md` architectural decision).
- `promoteDraftToApplication()` (Task 1) must be a **pure relocation** of `orphan-payments/promote`'s live draft-mode logic — zero behavior change. Every branch is pinned against the live file as read on 2026-08-20; if the live route has changed since, re-read it before implementing Task 1.
- The Complete & Submit action is `super_admin`-only, gated both server-side (route) and client-side (`useAdminRole()` per AGENTS.md's admin-gating convention) — mirrors `unexpire` and `edit-fields`.
- The confirm button must stay disabled while its mutation is in-flight. `ConfirmDialog` (`src/components/ui/confirm-dialog.tsx`) already does this via its `isPending` prop — use it, don't build a custom dialog that loses this.
- `LINK_FAILED` must write an admin-audit entry (`details.linkFailed: true`, `details.paymentRowId`) in the new route — this is the audit-trail gap the design review caught (spec §2 step 8). Do not regress it.
- The new route's duplicate-application check excludes both `pending_payment` and `rejected`. `orphan-payments/promote`'s own check is deliberately left excluding only `pending_payment` — out of scope for this plan.
- Run `npx vitest run` (the **full** suite, not just the new/changed file) before every commit that touches shared code (Tasks 1–3). This codebase has a documented history of task-scoped test runs missing regressions elsewhere (see `fb68ff5` in this repo's log — a prior session's own near-miss).
- Run `npx tsc --noEmit && npx eslint` before every commit.
- Task 4 (UI) touches no client-router hooks (`useSearchParams`/`usePathname`/`useRouter`), so a local `npx next build` is not required by AGENTS.md's build-check rule — `tsc`/`eslint` plus a manual dev-server check are sufficient.

---

### Task 1: Extract `promoteDraftToApplication()` with characterization tests

**Files:**
- Create: `src/lib/promote-draft-to-application.ts`
- Create: `__tests__/promote-draft-to-application.test.ts`

**Interfaces:**
- Consumes: `buildApplicationRow()` from `src/lib/build-application-row.ts` (unchanged signature), `scoreApplication()` + `ApprovalResult` from `src/lib/ai-approval.ts` (unchanged), `generateRefNumber()` from `src/lib/reference-number.ts` (unchanged), `DraftApplicationRow` from `src/types/database.types.ts` (unchanged).
- Produces (for Tasks 2 and 3):
  ```ts
  export type PromoteDraftResult =
    | { ok: true; applicationId: string; referenceNumber: string }
    | { ok: false; code: "ALREADY_EXISTS_RACE"; message: string }
    | { ok: false; code: "LINK_FAILED"; applicationId: string; referenceNumber: string; message: string }

  export interface PromoteDraftInput {
    draft: DraftApplicationRow
    email: string
    paymentId: string
    paymentRowId: string
    actorReason: string
    routeTag: string
  }

  export async function promoteDraftToApplication(
    input: PromoteDraftInput,
    supabase: SupabaseClient,
  ): Promise<PromoteDraftResult>
  ```

This task writes the test file first, confirms it fails on the missing module, then writes the lib to make it pass — same TDD shape as every other task, even though the target behavior is fully pinned by the live route rather than newly designed. That's what makes this a **characterization** test suite: it's proving the extraction is faithful, not designing new behavior.

- [ ] **Step 1: Write the full characterization test suite**

Create `__tests__/promote-draft-to-application.test.ts`:

```ts
/**
 * Characterization tests for promoteDraftToApplication() — extracted
 * 2026-08-20 from orphan-payments/promote/route.ts's draft-mode branch.
 * Every case here pins a specific behavior from the live route as it stood
 * at extraction time; this is the FIRST test coverage this logic has ever
 * had (grep -rl "orphan-payments/promote" __tests__/ returned nothing
 * before this file existed). See docs/superpowers/specs/2026-08-20-draft-
 * rescue-design.md §1 and §4.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const state = vi.hoisted(() => ({
  scoreApplicationMock: vi.fn(),
  buildApplicationRowMock: vi.fn(() => ({ mocked: "row" })),
  generateRefNumberMock: vi.fn(() => "AMASI-2026-FIXEDREF"),
  sentryCaptureMock: vi.fn(),
  pendingRow: null as { id: string; reference_number: string } | null,
  finalizeResult: { data: null as { id: string } | null, error: null as unknown },
  insertResult: { data: null as { id: string } | null, error: null as unknown },
  linkResult: { error: null as unknown },
  draftUpdateResult: { error: null as unknown },
  draftUpdateCalled: false,
}))

vi.mock("@sentry/nextjs", () => ({
  captureException: state.sentryCaptureMock,
}))

vi.mock("@/lib/ai-approval", () => ({
  scoreApplication: state.scoreApplicationMock,
}))

vi.mock("@/lib/build-application-row", () => ({
  buildApplicationRow: state.buildApplicationRowMock,
}))

vi.mock("@/lib/reference-number", () => ({
  generateRefNumber: state.generateRefNumberMock,
}))

function membershipApplicationsBuilder() {
  let verb: "select" | "update" | "insert" | null = null
  const b: Record<string, unknown> = {}
  b.select = () => { if (verb === null) verb = "select"; return b }
  b.update = () => { verb = "update"; return b }
  b.insert = () => { verb = "insert"; return b }
  b.eq = () => b
  b.order = () => b
  b.limit = () => b
  b.maybeSingle = async () => {
    if (verb === "select") return { data: state.pendingRow, error: null }
    if (verb === "update") return state.finalizeResult
    return { data: null, error: null }
  }
  b.single = async () => state.insertResult
  return b
}

function membershipPaymentsBuilder() {
  const b: Record<string, unknown> = {}
  b.update = () => b
  b.eq = () => b
  b.is = () => b
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(state.linkResult).then(resolve, reject)
  return b
}

function draftApplicationsBuilder() {
  const b: Record<string, unknown> = {}
  b.update = () => { state.draftUpdateCalled = true; return b }
  b.eq = () => b
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(state.draftUpdateResult).then(resolve, reject)
  return b
}

const supabase = {
  from: (table: string) => {
    if (table === "membership_applications") return membershipApplicationsBuilder()
    if (table === "membership_payments") return membershipPaymentsBuilder()
    if (table === "draft_applications") return draftApplicationsBuilder()
    throw new Error(`Unmocked table: ${table}`)
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any

import { promoteDraftToApplication } from "@/lib/promote-draft-to-application"

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    draft: {
      id: "draft-1",
      email: "kaustubh@example.com",
      step_data: { formData: { firstName: "Kaustubh" }, uploads: { photo: { fileUrl: "photo/x.jpg" } } },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    email: "kaustubh@example.com",
    paymentId: "pay_ABC123",
    paymentRowId: "payrow-1",
    actorReason: "test reason",
    routeTag: "test/route",
    ...overrides,
  }
}

function normalApproval(overrides: Record<string, unknown> = {}) {
  return {
    totalScore: 85,
    autoApprove: true,
    blockingReasons: [],
    checks: [],
    flags: [],
    nmcVerification: null,
    nmcApiStatus: null,
    nmcResponseTimeMs: null,
    bypassedDocs: [],
    lowConfidenceDocs: [],
    mediumConfidenceDocs: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.pendingRow = null
  state.finalizeResult = { data: null, error: null }
  state.insertResult = { data: { id: "app-1" }, error: null }
  state.linkResult = { error: null }
  state.draftUpdateResult = { error: null }
  state.draftUpdateCalled = false
  state.scoreApplicationMock.mockResolvedValue(normalApproval())
})

describe("promoteDraftToApplication", () => {
  it("happy path: fresh insert, links payment, soft-completes draft", async () => {
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result).toEqual({ ok: true, applicationId: "app-1", referenceNumber: "AMASI-2026-FIXEDREF" })
    expect(state.scoreApplicationMock).toHaveBeenCalledWith(
      { firstName: "Kaustubh" },
      { photo: { fileUrl: "photo/x.jpg" } },
      true,
      supabase,
    )
    expect(state.draftUpdateCalled).toBe(true)
    expect(state.sentryCaptureMock).not.toHaveBeenCalled()
  })

  it("finalizes an existing pending_payment skeleton in place instead of inserting fresh", async () => {
    state.pendingRow = { id: "skeleton-1", reference_number: "AMASI-2026-OLDREF" }
    state.finalizeResult = { data: { id: "skeleton-1" }, error: null }
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result).toEqual({ ok: true, applicationId: "skeleton-1", referenceNumber: "AMASI-2026-OLDREF" })
    expect(state.generateRefNumberMock).not.toHaveBeenCalled()
  })

  it("falls back to a neutral approval when scoring throws, and still succeeds", async () => {
    state.scoreApplicationMock.mockRejectedValueOnce(new Error("network down"))
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result.ok).toBe(true)
    expect(state.sentryCaptureMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ level: "warning", tags: expect.objectContaining({ op: "scoring_failed" }) }),
    )
    const rowArgs = state.buildApplicationRowMock.mock.calls[0][0]
    expect(rowArgs.approval).toMatchObject({ totalScore: 0, autoApprove: false, blockingReasons: ["scoring_skipped"] })
  })

  it("routes documents_unreadable decisions to applicationStatus 'documents_unreadable'", async () => {
    state.scoreApplicationMock.mockResolvedValue(normalApproval({ decision: "documents_unreadable", totalScore: 0 }))
    await promoteDraftToApplication(baseInput(), supabase)
    const rowArgs = state.buildApplicationRowMock.mock.calls[0][0]
    expect(rowArgs.documentsUnreadable).toBe(true)
    expect(rowArgs.applicationStatus).toBe("documents_unreadable")
  })

  it("returns ALREADY_EXISTS_RACE when the finalize update loses a race (0 rows matched)", async () => {
    state.pendingRow = { id: "skeleton-1", reference_number: "AMASI-2026-OLDREF" }
    state.finalizeResult = { data: null, error: null }
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result).toEqual({
      ok: false,
      code: "ALREADY_EXISTS_RACE",
      message: "Application was just finalized elsewhere.",
    })
  })

  it("returns ALREADY_EXISTS_RACE (distinct message) when the insert throws Postgres 23505", async () => {
    state.insertResult = { data: null, error: { code: "23505", message: "duplicate key" } }
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result).toEqual({
      ok: false,
      code: "ALREADY_EXISTS_RACE",
      message: "An active application already exists for this applicant.",
    })
  })

  it("propagates any other thrown insert error instead of swallowing it", async () => {
    state.insertResult = { data: null, error: { code: "OTHER", message: "boom" } }
    await expect(promoteDraftToApplication(baseInput(), supabase)).rejects.toMatchObject({ code: "OTHER" })
  })

  it("LINK_FAILED: returns the applicationId + referenceNumber, and NEVER soft-completes the draft", async () => {
    state.linkResult = { error: { message: "link boom" } }
    const result = await promoteDraftToApplication(baseInput(), supabase)
    expect(result).toEqual({
      ok: false,
      code: "LINK_FAILED",
      applicationId: "app-1",
      referenceNumber: "AMASI-2026-FIXEDREF",
      message: "Application created but payment link failed. Please retry.",
    })
    expect(state.draftUpdateCalled).toBe(false)
    expect(state.sentryCaptureMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ level: "error", tags: expect.objectContaining({ op: "link_failed" }) }),
    )
  })

  it("never sets allAiVerified: true, even for a perfect score — this path never auto-approves", async () => {
    state.scoreApplicationMock.mockResolvedValue(normalApproval({ totalScore: 100, autoApprove: true }))
    await promoteDraftToApplication(baseInput(), supabase)
    const rowArgs = state.buildApplicationRowMock.mock.calls[0][0]
    expect(rowArgs.allAiVerified).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `npx vitest run __tests__/promote-draft-to-application.test.ts`
Expected: FAIL — `Cannot find module '@/lib/promote-draft-to-application'` (or similar resolve error). This confirms the test file itself is wired correctly and isn't accidentally passing against nothing.

- [ ] **Step 3: Write the extracted lib**

Create `src/lib/promote-draft-to-application.ts`:

```ts
// Extracted from src/app/api/admin/orphan-payments/promote/route.ts's
// draft-mode branch (2026-08-20) so the Complete & Submit action on
// payment_on_hold drafts (src/app/api/admin/drafts/[id]/complete-and-submit)
// can reuse the exact same reconstruction logic instead of a second
// implementation. See docs/superpowers/specs/2026-08-20-draft-rescue-design.md §1.
//
// PURE RELOCATION: every branch below matches orphan-payments/promote's live
// behavior line-for-line as of the extraction. Do not "clean up" or
// restructure this without re-reading that route's own comments first —
// several odd-looking choices (e.g. finalizing a pending_payment skeleton in
// place instead of inserting fresh) are load-bearing for other flows.
/* eslint-disable @typescript-eslint/no-explicit-any -- mirrors the loose
   `any` the source route uses for step_data.formData/uploads. */
import * as Sentry from "@sentry/nextjs"
import type { SupabaseClient } from "@supabase/supabase-js"
import { buildApplicationRow } from "@/lib/build-application-row"
import { scoreApplication, type ApprovalResult } from "@/lib/ai-approval"
import { generateRefNumber } from "@/lib/reference-number"
import type { DraftApplicationRow } from "@/types/database.types"

export type PromoteDraftResult =
  | { ok: true; applicationId: string; referenceNumber: string }
  | { ok: false; code: "ALREADY_EXISTS_RACE"; message: string }
  | { ok: false; code: "LINK_FAILED"; applicationId: string; referenceNumber: string; message: string }

export interface PromoteDraftInput {
  draft: DraftApplicationRow
  email: string // lowercased, trimmed
  paymentId: string // gateway_payment_id (pay_...)
  paymentRowId: string // membership_payments.id — used for the link update
  actorReason: string // human-readable reason string, stored on the row
  // Distinguishes call sites in Sentry tags for the three non-fatal-warning
  // captures below (scoring_failed, link_failed, draft_soft_complete_failed),
  // none of which have a corresponding failure code in PromoteDraftResult —
  // the caller can't re-tag them after the fact, so the tag has to come in.
  routeTag: string
}

function fallbackApproval(): ApprovalResult {
  return {
    totalScore: 0,
    autoApprove: false,
    blockingReasons: ["scoring_skipped"],
    checks: [],
    flags: ["promote_draft: AI scoring skipped"],
    nmcVerification: null,
    nmcApiStatus: null,
    nmcResponseTimeMs: null,
    bypassedDocs: [],
    lowConfidenceDocs: [],
    mediumConfidenceDocs: [],
  }
}

export async function promoteDraftToApplication(
  input: PromoteDraftInput,
  supabase: SupabaseClient,
): Promise<PromoteDraftResult> {
  const { draft, email, paymentId, paymentRowId, actorReason, routeTag } = input
  const stepData = (draft.step_data || {}) as Record<string, any>
  const formData = stepData.formData as Record<string, any>
  const uploads = stepData.uploads as Record<string, any>

  let approval: ApprovalResult
  try {
    approval = await scoreApplication(formData, uploads, true, supabase)
  } catch (e) {
    Sentry.captureException(e, {
      level: "warning",
      tags: { route: routeTag, op: "scoring_failed" },
    })
    approval = fallbackApproval()
  }

  const documentsUnreadable = approval.decision === "documents_unreadable"
  const aiConfidence = documentsUnreadable
    ? "documents_unreadable"
    : approval.totalScore >= 80
      ? "high"
      : approval.totalScore >= 50
        ? "medium"
        : "low"
  const applicationStatus = documentsUnreadable ? "documents_unreadable" : "pending_review"

  // Finalize an early pending_payment skeleton in place if one exists; else INSERT.
  const { data: pendingRow } = await supabase
    .from("membership_applications")
    .select("id, reference_number")
    .eq("email", email)
    .eq("status", "pending_payment")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const referenceNumber: string = pendingRow?.reference_number || generateRefNumber()

  const row = buildApplicationRow({
    referenceNumber,
    formData,
    uploads,
    paymentId,
    emailVerified: true,
    mobileVerified: false,
    allAiVerified: false,
    documentsUnreadable,
    approval,
    aiConfidence,
    aiFlags: approval.flags,
    hasPendingReview: true,
    manualReviewReason: actorReason,
    applicationStatus,
  })

  let appId: string

  try {
    if (pendingRow) {
      const { data: finalized, error: finalizeErr } = await supabase
        .from("membership_applications")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", pendingRow.id)
        .eq("status", "pending_payment")
        .select("id")
        .maybeSingle()
      if (finalizeErr) throw finalizeErr
      if (!finalized) {
        // Lost a race — already finalized by another path.
        return { ok: false, code: "ALREADY_EXISTS_RACE", message: "Application was just finalized elsewhere." }
      }
      appId = finalized.id
    } else {
      const { data: inserted, error: insertErr } = await supabase
        .from("membership_applications")
        .insert(row)
        .select("id")
        .single()
      if (insertErr) throw insertErr
      appId = inserted!.id
    }
  } catch (e: any) {
    if (e?.code === "23505") {
      return {
        ok: false,
        code: "ALREADY_EXISTS_RACE",
        message: "An active application already exists for this applicant.",
      }
    }
    throw e
  }

  // Link the payment — guarded so a race can't double-link.
  const { error: linkErr } = await supabase
    .from("membership_payments")
    .update({ application_id: appId })
    .eq("id", paymentRowId)
    .is("application_id", null)
  if (linkErr) {
    Sentry.captureException(linkErr, {
      level: "error",
      tags: { route: routeTag, op: "link_failed" },
      extra: { appId, paymentRowId },
    })
    // Do NOT soft-complete the draft below — it stays visible at
    // payment_on_hold so an admin can see and retry from it, rather than
    // disappearing into an unlinked, unreachable state.
    return {
      ok: false,
      code: "LINK_FAILED",
      applicationId: appId,
      referenceNumber,
      message: "Application created but payment link failed. Please retry.",
    }
  }

  // Soft-complete the source draft so it leaves the incomplete pile.
  const { error: draftErr } = await supabase
    .from("draft_applications")
    .update({
      status: "completed",
      failure_reason: null,
      deleted_at: new Date().toISOString(),
      step_data: {
        ...stepData,
        payment_id: paymentId,
        recovered_at: new Date().toISOString(),
        recovered_application_id: appId,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", draft.id)
  if (draftErr) {
    // Non-fatal: the application + payment are already correct.
    Sentry.captureException(draftErr, {
      level: "warning",
      tags: { route: routeTag, op: "draft_soft_complete_failed" },
      extra: { draftId: draft.id, appId },
    })
  }

  return { ok: true, applicationId: appId, referenceNumber }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/promote-draft-to-application.test.ts`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/promote-draft-to-application.ts __tests__/promote-draft-to-application.test.ts`
Expected: no errors.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS — no regressions anywhere else (this task added a new file; it shouldn't touch existing behavior at all).

- [ ] **Step 7: Commit**

```bash
git add src/lib/promote-draft-to-application.ts __tests__/promote-draft-to-application.test.ts
git commit -m "$(cat <<'EOF'
feat(drafts): extract promoteDraftToApplication from orphan-payments/promote

Pure relocation of the draft-mode reconstruction logic, characterized by
the first tests this code has ever had — sets up reuse for the Complete &
Submit action on payment_on_hold drafts (docs/superpowers/specs/2026-08-20-
draft-rescue-design.md).
EOF
)"
```

---

### Task 2: Rewire `orphan-payments/promote` to call the shared function

**Files:**
- Modify: `src/app/api/admin/orphan-payments/promote/route.ts`

**Interfaces:**
- Consumes: `promoteDraftToApplication`, `PromoteDraftInput`, `PromoteDraftResult` from Task 1's `src/lib/promote-draft-to-application.ts`.
- Produces: no change to this route's external contract (request/response shapes, status codes) — this task is a refactor, not a feature change. Nothing downstream should need to change because of it.

This task has no new tests of its own — Task 1's characterization suite already covers the logic being delegated to. The verification here is that the route's *external behavior* is provably unchanged: full suite green, plus a manual diff read.

- [ ] **Step 1: Remove the now-dead imports and the inlined `fallbackApproval` helper**

In `src/app/api/admin/orphan-payments/promote/route.ts`, remove these imports (no longer used in this file — they moved into the lib):

```ts
import { buildApplicationRow } from "@/lib/build-application-row"
import { scoreApplication, type ApprovalResult } from "@/lib/ai-approval"
```

Remove the `fallbackApproval()` function definition (currently lines 42–56, right after `isPlaceholderEmail`).

Add the new import:

```ts
import { promoteDraftToApplication } from "@/lib/promote-draft-to-application"
```

(Keep `generateRefNumber` imported — still used by the skeleton-mode branch.)

- [ ] **Step 2: Replace the draft-mode branch's body**

Find this block (currently inside `if (canReconstruct) { ... }`, roughly lines 206–282):

```ts
      mode = "draft"
      let approval: ApprovalResult
      try {
        approval = await scoreApplication(formData!, uploads as any, true, supabase)
      } catch (e) {
        Sentry.captureException(e, {
          level: "warning",
          tags: { route: "admin/orphan-payments/promote", op: "scoring_failed" },
        })
        approval = fallbackApproval()
      }

      const documentsUnreadable = approval.decision === "documents_unreadable"
      const aiConfidence = documentsUnreadable
        ? "documents_unreadable"
        : approval.totalScore >= 80
          ? "high"
          : approval.totalScore >= 50
            ? "medium"
            : "low"
      const applicationStatus = documentsUnreadable ? "documents_unreadable" : "pending_review"

      // Finalize an early pending_payment skeleton in place if one exists; else INSERT.
      const { data: pendingRow } = await supabase
        .from("membership_applications")
        .select("id, reference_number")
        .eq("email", email!)
        .eq("status", "pending_payment")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      referenceNumber = pendingRow?.reference_number || generateRefNumber()

      const row = buildApplicationRow({
        referenceNumber,
        formData: formData!,
        uploads: uploads as any,
        paymentId: paymentId!,
        emailVerified: true,
        mobileVerified: false,
        allAiVerified: false,
        documentsUnreadable,
        approval,
        aiConfidence,
        aiFlags: approval.flags,
        hasPendingReview: true,
        manualReviewReason: reason,
        applicationStatus,
      })

      if (pendingRow) {
        const { data: finalized, error: finalizeErr } = await supabase
          .from("membership_applications")
          .update({ ...row, updated_at: new Date().toISOString() })
          .eq("id", pendingRow.id)
          .eq("status", "pending_payment")
          .select("id")
          .maybeSingle()
        if (finalizeErr) throw finalizeErr
        if (!finalized) {
          // Lost a race — already finalized by another path. Treat as success.
          return Response.json(
            { status: false, code: "ALREADY_EXISTS", message: "Application was just finalized elsewhere." },
            { status: 409 }
          )
        }
        appId = finalized.id
      } else {
        const { data: inserted, error: insertErr } = await supabase
          .from("membership_applications")
          .insert(row)
          .select("id")
          .single()
        if (insertErr) throw insertErr
        appId = inserted!.id
      }
```

Replace it with:

```ts
      mode = "draft"
      // Delegates to the shared reconstruction function — extracted 2026-08-20
      // so the Complete & Submit action on payment_on_hold drafts can reuse
      // this exact logic. See src/lib/promote-draft-to-application.ts and
      // docs/superpowers/specs/2026-08-20-draft-rescue-design.md §1.
      const result = await promoteDraftToApplication(
        {
          draft: draft!,
          email: email!,
          paymentId: paymentId!,
          paymentRowId: pay.id,
          actorReason: reason,
          routeTag: "admin/orphan-payments/promote",
        },
        supabase,
      )
      if (!result.ok && result.code === "ALREADY_EXISTS_RACE") {
        return Response.json(
          { status: false, code: "ALREADY_EXISTS", message: result.message },
          { status: 409 }
        )
      }
      if (!result.ok && result.code === "LINK_FAILED") {
        return Response.json(
          { status: false, code: "LINK_FAILED", applicationId: result.applicationId, message: result.message },
          { status: 500 }
        )
      }
      if (!result.ok) {
        throw new Error("Unhandled promoteDraftToApplication failure code")
      }
      appId = result.applicationId
      referenceNumber = result.referenceNumber
```

Note: `promoteDraftToApplication()` already performs the payment link (§1 step 5) and draft soft-complete (§1 step 6) internally for draft mode. The route's own "--- 5. Link the orphan payment ---" and "--- 6. Soft-complete the draft ---" sections below the `try`/`catch` (currently unconditional) must **not** run a second time for draft mode — see Step 3.

- [ ] **Step 3: Scope the existing link + soft-complete sections to skeleton mode only**

Find the two blocks after the `try { ... } catch { ... }` closes (currently unconditional, roughly lines 333–384):

```ts
  // --- 5. Link the orphan payment to the new application ---
  const { error: linkErr } = await supabase
    .from("membership_payments")
    .update({ application_id: appId })
    .eq("id", pay.id)
    .is("application_id", null)
  if (linkErr) {
    Sentry.captureException(linkErr, {
      level: "error",
      tags: { route: "admin/orphan-payments/promote", op: "link_failed" },
      extra: { appId, paymentRowId },
    })
    // The application exists but the payment didn't link — surface loudly so it
    // doesn't silently re-appear as an orphan. Admin can retry safely
    // (idempotency now resolves to the just-created application).
    return Response.json(
      {
        status: false,
        code: "LINK_FAILED",
        applicationId: appId,
        message: "Application created but payment link failed. Please retry.",
      },
      { status: 500 }
    )
  }

  // --- 6. Soft-complete the draft so it leaves the incomplete pile ---
  if (draft) {
    const { error: draftErr } = await supabase
      .from("draft_applications")
      .update({
        status: "completed",
        failure_reason: null,
        deleted_at: new Date().toISOString(),
        step_data: {
          ...stepData,
          payment_id: paymentId,
          recovered_at: new Date().toISOString(),
          recovered_application_id: appId,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", draft.id)
    if (draftErr) {
      // Non-fatal: the application + payment are already correct. Log and move on.
      Sentry.captureException(draftErr, {
        level: "warning",
        tags: { route: "admin/orphan-payments/promote", op: "draft_soft_complete_failed" },
        extra: { draftId: draft.id, appId },
      })
    }
  }
```

Wrap both blocks in `if (mode === "skeleton") { ... }`, and add a one-line comment above explaining why:

```ts
  // Skeleton mode only — draft mode already linked the payment and
  // soft-completed the draft inside promoteDraftToApplication() above.
  if (mode === "skeleton") {
    // --- 5. Link the orphan payment to the new application ---
    const { error: linkErr } = await supabase
      .from("membership_payments")
      .update({ application_id: appId })
      .eq("id", pay.id)
      .is("application_id", null)
    if (linkErr) {
      Sentry.captureException(linkErr, {
        level: "error",
        tags: { route: "admin/orphan-payments/promote", op: "link_failed" },
        extra: { appId, paymentRowId },
      })
      return Response.json(
        {
          status: false,
          code: "LINK_FAILED",
          applicationId: appId,
          message: "Application created but payment link failed. Please retry.",
        },
        { status: 500 }
      )
    }

    // --- 6. Soft-complete the draft so it leaves the incomplete pile ---
    if (draft) {
      const { error: draftErr } = await supabase
        .from("draft_applications")
        .update({
          status: "completed",
          failure_reason: null,
          deleted_at: new Date().toISOString(),
          step_data: {
            ...stepData,
            payment_id: paymentId,
            recovered_at: new Date().toISOString(),
            recovered_application_id: appId,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", draft.id)
      if (draftErr) {
        Sentry.captureException(draftErr, {
          level: "warning",
          tags: { route: "admin/orphan-payments/promote", op: "draft_soft_complete_failed" },
          extra: { draftId: draft.id, appId },
        })
      }
    }
  }
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/admin/orphan-payments/promote/route.ts`
Expected: no errors. (If `ApprovalResult`/`scoreApplication`/`buildApplicationRow` still appear anywhere in the file after Step 1, eslint's unused-import rule will catch a missed removal — fix before proceeding.)

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS. No test file targets this route directly today (confirmed during spec-writing: `grep -rl "orphan-payments/promote" __tests__/` returns nothing), so this step's job is catching regressions in *other* files that might import something from this route — unlikely, but the Global Constraints rule applies uniformly.

- [ ] **Step 6: Manual side-by-side diff verification**

Run: `git diff src/app/api/admin/orphan-payments/promote/route.ts`

Read the full diff and confirm, branch by branch:
- Every `Response.json(...)` call in the diff has the identical status code, `code` field, and `message`/`status` field wording as the version it replaced.
- The skeleton-mode branch (the `else` of `if (canReconstruct)`) is byte-for-byte unchanged.
- The pre-checks above the try/catch (already-linked, already-exists-by-payment, already-exists-by-email, no-identity) and the final audit + response block below are unchanged.

This is a manual review step, not a script — there's no automated way to assert "this refactor changed nothing observable" beyond reading it, since the whole point of Task 1 was to make the *test suite* assert that instead of a human's memory of the old code.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/orphan-payments/promote/route.ts
git commit -m "$(cat <<'EOF'
refactor(orphan-payments): delegate draft-mode reconstruction to the shared lib

orphan-payments/promote now calls promoteDraftToApplication() instead of
inlining the logic. Skeleton mode and every pre-check/response shape are
unchanged — verified via full suite + manual diff review, since this route
had zero prior test coverage before Task 1's characterization suite.
EOF
)"
```

---

### Task 3: New route `POST /api/admin/drafts/[id]/complete-and-submit`

**Files:**
- Create: `src/app/api/admin/drafts/[id]/complete-and-submit/route.ts`
- Create: `__tests__/complete-and-submit.test.ts`

**Interfaces:**
- Consumes: `promoteDraftToApplication`, `PromoteDraftInput`, `PromoteDraftResult` from Task 1. `getAdminSession()` from `@/lib/auth`. `createAdminClient()` from `@/lib/supabase`. `logAdminAction()` from `@/lib/audit-log`.
- Produces (for Task 4):
  ```
  POST /api/admin/drafts/{draftId}/complete-and-submit
  200 { ok: true, applicationId: string, referenceNumber: string }
  401/403/404 { error: string }
  409 { error: string }                                            // wrong status
  422 { error: string }                                            // no unlinked paid payment / canReconstruct guard
  409 { ok: false, code: "ALREADY_EXISTS", applicationId, referenceNumber, error: string }
  409 { ok: false, code: "ALREADY_EXISTS_RACE", error: string }
  500 { ok: false, code: "LINK_FAILED", applicationId: string, error: string }
  500 { error: string }                                            // unexpected
  ```

- [ ] **Step 1: Write the failing route tests**

Create `__tests__/complete-and-submit.test.ts`:

```ts
/**
 * Route-level tests for POST /api/admin/drafts/[id]/complete-and-submit.
 * The shared reconstruction logic (promoteDraftToApplication) is mocked
 * here and already has its own coverage in
 * __tests__/promote-draft-to-application.test.ts — this file only tests
 * auth/status-gating glue: load, guard, look up payment, check for an
 * existing application, call the lib, map its result.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const state = vi.hoisted(() => ({
  sessionMock: vi.fn(async () => ({ email: "admin@test.com", name: "Admin", adminRole: "super_admin" })),
  promoteMock: vi.fn(),
  logAdminActionMock: vi.fn(async () => undefined),
  draftRow: null as Record<string, unknown> | null,
  paymentRow: null as Record<string, unknown> | null,
  existingAppRow: null as Record<string, unknown> | null,
  paymentQueryCalls: [] as [string, ...unknown[]][],
  appQueryCalls: [] as [string, ...unknown[]][],
}))

vi.mock("@/lib/auth", () => ({
  getAdminSession: state.sessionMock,
}))

vi.mock("@/lib/promote-draft-to-application", () => ({
  promoteDraftToApplication: state.promoteMock,
}))

vi.mock("@/lib/audit-log", () => ({
  logAdminAction: state.logAdminActionMock,
}))

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}))

function draftApplicationsBuilder() {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = () => b
  b.maybeSingle = async () => ({ data: state.draftRow, error: null })
  return b
}

function membershipPaymentsBuilder() {
  const b: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    state.paymentQueryCalls.push([name, ...args])
    return b
  }
  b.select = record("select")
  b.ilike = record("ilike")
  b.eq = record("eq")
  b.is = record("is")
  b.order = record("order")
  b.limit = record("limit")
  b.maybeSingle = async () => ({ data: state.paymentRow, error: null })
  return b
}

function membershipApplicationsBuilder() {
  const b: Record<string, unknown> = {}
  const record = (name: string) => (...args: unknown[]) => {
    state.appQueryCalls.push([name, ...args])
    return b
  }
  b.select = record("select")
  b.eq = record("eq")
  b.neq = record("neq")
  b.order = record("order")
  b.limit = record("limit")
  b.maybeSingle = async () => ({ data: state.existingAppRow, error: null })
  return b
}

vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "draft_applications") return draftApplicationsBuilder()
      if (table === "membership_payments") return membershipPaymentsBuilder()
      if (table === "membership_applications") return membershipApplicationsBuilder()
      throw new Error(`Unmocked table: ${table}`)
    },
  })),
}))

import { POST } from "@/app/api/admin/drafts/[id]/complete-and-submit/route"
import type { NextRequest } from "next/server"

function buildRequest(): NextRequest {
  return new Request("https://test.local/api/admin/drafts/draft-1/complete-and-submit", {
    method: "POST",
  }) as unknown as NextRequest
}

function call() {
  return POST(buildRequest(), { params: Promise.resolve({ id: "draft-1" }) })
}

const validDraft = {
  id: "draft-1",
  email: "kaustubh@example.com",
  status: "payment_on_hold",
  step_data: { formData: { firstName: "Kaustubh" }, uploads: { photo: {} } },
}

const validPayment = { id: "payrow-1", gateway_payment_id: "pay_ABC123", amount: 5000, currency: "INR" }

beforeEach(() => {
  vi.clearAllMocks()
  state.sessionMock.mockResolvedValue({ email: "admin@test.com", name: "Admin", adminRole: "super_admin" })
  state.draftRow = validDraft
  state.paymentRow = validPayment
  state.existingAppRow = null
  state.paymentQueryCalls = []
  state.appQueryCalls = []
})

describe("POST /api/admin/drafts/[id]/complete-and-submit", () => {
  it("401s when there is no session", async () => {
    state.sessionMock.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
  })

  it("403s for a non-super_admin session", async () => {
    state.sessionMock.mockResolvedValue({ email: "a@test.com", adminRole: "admin" })
    const res = await call()
    expect(res.status).toBe(403)
  })

  it("404s when the draft doesn't exist", async () => {
    state.draftRow = null
    const res = await call()
    expect(res.status).toBe(404)
  })

  it("409s for a draft not in payment_on_hold, with the actual status in the message", async () => {
    state.draftRow = { ...validDraft, status: "stuck" }
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.error).toMatch(/stuck/)
  })

  it("422s when there is no unlinked paid payment", async () => {
    state.paymentRow = null
    const res = await call()
    expect(res.status).toBe(422)
    expect(state.promoteMock).not.toHaveBeenCalled()
  })

  it("queries membership_payments with the application_id IS NULL guard", async () => {
    await call()
    const isCalls = state.paymentQueryCalls.filter((c) => c[0] === "is")
    expect(isCalls).toContainEqual(["is", "application_id", null])
  })

  it("409s ALREADY_EXISTS when an application already exists (not pending_payment, not rejected)", async () => {
    state.existingAppRow = { id: "app-existing", reference_number: "AMASI-2026-OLD" }
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe("ALREADY_EXISTS")
    expect(body.applicationId).toBe("app-existing")
    expect(state.promoteMock).not.toHaveBeenCalled()
  })

  it("excludes both pending_payment and rejected from the duplicate-application check", async () => {
    await call()
    const neqCalls = state.appQueryCalls.filter((c) => c[0] === "neq")
    expect(neqCalls).toContainEqual(["neq", "status", "pending_payment"])
    expect(neqCalls).toContainEqual(["neq", "status", "rejected"])
  })

  it("422s when the draft lacks formData/uploads (canReconstruct guard)", async () => {
    state.draftRow = { ...validDraft, step_data: {} }
    const res = await call()
    expect(res.status).toBe(422)
    expect(state.promoteMock).not.toHaveBeenCalled()
  })

  it("409s ALREADY_EXISTS_RACE, passing the lib's message through, no audit log", async () => {
    state.promoteMock.mockResolvedValue({ ok: false, code: "ALREADY_EXISTS_RACE", message: "raced" })
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe("ALREADY_EXISTS_RACE")
    expect(body.error).toBe("raced")
    expect(state.logAdminActionMock).not.toHaveBeenCalled()
  })

  it("500s LINK_FAILED, passing applicationId through, AND logs the admin action with linkFailed: true", async () => {
    state.promoteMock.mockResolvedValue({
      ok: false,
      code: "LINK_FAILED",
      applicationId: "app-1",
      referenceNumber: "AMASI-2026-REF",
      message: "link broke",
    })
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.code).toBe("LINK_FAILED")
    expect(body.applicationId).toBe("app-1")
    expect(state.logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "draft_complete_and_submit",
        entityId: "app-1",
        details: expect.objectContaining({ linkFailed: true, paymentRowId: "payrow-1" }),
      }),
    )
  })

  it("happy path: 200, returns applicationId/referenceNumber, logs the admin action without linkFailed", async () => {
    state.promoteMock.mockResolvedValue({ ok: true, applicationId: "app-1", referenceNumber: "AMASI-2026-REF" })
    const res = await call()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true, applicationId: "app-1", referenceNumber: "AMASI-2026-REF" })
    expect(state.logAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "draft_complete_and_submit", entityId: "app-1" }),
    )
    const details = state.logAdminActionMock.mock.calls[0][0].details
    expect(details.linkFailed).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `npx vitest run __tests__/complete-and-submit.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/admin/drafts/[id]/complete-and-submit/route'`.

- [ ] **Step 3: Write the route**

Create `src/app/api/admin/drafts/[id]/complete-and-submit/route.ts`:

```ts
// Complete & Submit — promotes a payment_on_hold draft (applicant paid but
// never finished submitting) into a reviewable application, reusing the
// same reconstruction logic orphan-payments/promote uses. See
// docs/superpowers/specs/2026-08-20-draft-rescue-design.md §2.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import { promoteDraftToApplication } from "@/lib/promote-draft-to-application"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: draftId } = await params
  if (!draftId) {
    return Response.json({ error: "draftId is required" }, { status: 400 })
  }

  const session = await getAdminSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.adminRole !== "super_admin") {
    return Response.json(
      { error: "This action requires super_admin. Please contact the AMASI admin team." },
      { status: 403 },
    )
  }
  const actorEmail = (session.email as string) || "admin"
  const actorName = (session.name as string) || "AMASI Admin"

  const supabase = createAdminClient()

  // --- 1. Load the draft ---
  const { data: draft, error: draftLoadErr } = await supabase
    .from("draft_applications")
    .select("*")
    .eq("id", draftId)
    .maybeSingle()

  if (draftLoadErr) {
    console.error("[admin/drafts/complete-and-submit] draft lookup error:", draftLoadErr.message)
    return Response.json({ error: "Failed to load draft" }, { status: 500 })
  }
  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 })
  }

  // --- 2. Status guard ---
  if (draft.status !== "payment_on_hold") {
    return Response.json(
      { error: `This action only applies to drafts with status "payment_on_hold". Current status: "${draft.status}".` },
      { status: 409 },
    )
  }

  const email = (draft.email as string).toLowerCase().trim()

  // --- 3. Find the linked-eligible paid payment. The .is("application_id",
  // null) clause is load-bearing: without it, a payment for this email
  // that's already linked to a different application could win the sort and
  // only get rejected later inside promoteDraftToApplication's own link-step
  // guard — landing in a 500 LINK_FAILED instead of this clean 422. ---
  const { data: payment, error: paymentErr } = await supabase
    .from("membership_payments")
    .select("id, gateway_payment_id, amount, currency")
    .ilike("member_email", email)
    .eq("status", "paid")
    .is("application_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (paymentErr) {
    console.error("[admin/drafts/complete-and-submit] payment lookup error:", paymentErr.message)
    return Response.json({ error: "Failed to load payment" }, { status: 500 })
  }
  if (!payment) {
    return Response.json(
      { error: "No unlinked paid payment found for this applicant. Nothing to complete." },
      { status: 422 },
    )
  }

  // --- 4. Idempotency: an application already exists for this email at any
  // status other than pending_payment (finalized inside the lib, not a
  // conflict) or rejected (a legitimately re-applying applicant). ---
  const { data: existingApp } = await supabase
    .from("membership_applications")
    .select("id, reference_number")
    .eq("email", email)
    .neq("status", "pending_payment")
    .neq("status", "rejected")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingApp) {
    return Response.json(
      {
        ok: false,
        code: "ALREADY_EXISTS",
        applicationId: existingApp.id,
        referenceNumber: existingApp.reference_number,
        error: `An application already exists for ${email} (${existingApp.reference_number ?? existingApp.id}).`,
      },
      { status: 409 },
    )
  }

  // --- 5. canReconstruct guard ---
  const stepData = (draft.step_data || {}) as Record<string, unknown>
  if (!stepData.formData || !stepData.uploads) {
    return Response.json(
      {
        error:
          "This draft reached payment_on_hold without complete formData/uploads, which shouldn't happen — reconcile manually.",
      },
      { status: 422 },
    )
  }

  const reason =
    `Completed from stuck payment_on_hold draft by ${actorEmail}: applicant paid ` +
    `₹${payment.amount} (${payment.gateway_payment_id}) but never finished submitting. ` +
    "Promoted from their saved draft data. Routed to manual review; verify before approving."

  // --- 6. Promote ---
  let result
  try {
    result = await promoteDraftToApplication(
      {
        draft,
        email,
        paymentId: payment.gateway_payment_id,
        paymentRowId: payment.id,
        actorReason: reason,
        routeTag: "admin/drafts/complete-and-submit",
      },
      supabase,
    )
  } catch (e) {
    Sentry.captureException(e, {
      level: "error",
      tags: { route: "admin/drafts/complete-and-submit", op: "persist_failed" },
      extra: { draftId, paymentRowId: payment.id, email },
    })
    return Response.json({ error: "Failed to create application" }, { status: 500 })
  }

  // --- 7/8. Map the result + audit ---
  if (!result.ok && result.code === "ALREADY_EXISTS_RACE") {
    return Response.json({ ok: false, code: "ALREADY_EXISTS_RACE", error: result.message }, { status: 409 })
  }
  if (!result.ok && result.code === "LINK_FAILED") {
    await logAdminAction({
      adminEmail: actorEmail,
      adminName: actorName,
      action: "draft_complete_and_submit",
      entityType: "application",
      entityId: result.applicationId,
      details: {
        draftId,
        referenceNumber: result.referenceNumber,
        paymentId: payment.gateway_payment_id,
        email,
        linkFailed: true,
        paymentRowId: payment.id,
      },
    })
    return Response.json(
      { ok: false, code: "LINK_FAILED", applicationId: result.applicationId, error: result.message },
      { status: 500 },
    )
  }
  if (!result.ok) {
    Sentry.captureException(new Error("Unhandled promoteDraftToApplication failure code"), {
      level: "error",
      tags: { route: "admin/drafts/complete-and-submit" },
    })
    return Response.json({ error: "Unexpected error" }, { status: 500 })
  }

  await logAdminAction({
    adminEmail: actorEmail,
    adminName: actorName,
    action: "draft_complete_and_submit",
    entityType: "application",
    entityId: result.applicationId,
    details: { draftId, referenceNumber: result.referenceNumber, paymentId: payment.gateway_payment_id, email },
  })

  return Response.json({ ok: true, applicationId: result.applicationId, referenceNumber: result.referenceNumber })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/complete-and-submit.test.ts`
Expected: PASS — all 12 tests green.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/api/admin/drafts/[id]/complete-and-submit/route.ts __tests__/complete-and-submit.test.ts`
Expected: no errors.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/drafts/[id]/complete-and-submit/route.ts __tests__/complete-and-submit.test.ts
git commit -m "$(cat <<'EOF'
feat(drafts): add Complete & Submit route for payment_on_hold drafts

New POST /api/admin/drafts/[id]/complete-and-submit, super_admin-gated,
reuses promoteDraftToApplication(). Excludes rejected (not just
pending_payment) from its duplicate-application check, and logs the admin
action even when the payment link fails, per design review.
EOF
)"
```

---

### Task 4: UI — "Complete & Submit" button on `/incomplete`

**Files:**
- Modify: `src/app/incomplete/page.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/drafts/{draftId}/complete-and-submit` from Task 3.
- Produces: no new exports — this is a leaf UI change.

- [ ] **Step 1: Add the `CheckCircle2` icon import**

In the `lucide-react` import block near the top of `src/app/incomplete/page.tsx`, add `CheckCircle2` to the existing list:

```ts
import {
  Search, Loader2, Inbox, Eye, Trash2, Send, Clock,
  AlertTriangle, CreditCard, RotateCcw, FileX, PauseCircle,
  XCircle, AlertCircle, Mail, MessageCircle, Pencil, CheckCircle2,
} from "lucide-react"
```

- [ ] **Step 2: Add dialog state**

Next to the other dialog-state declarations (near `unexpireDialogDraft`), add:

```ts
  const [completeDialogDraft, setCompleteDialogDraft] = useState<IncompleteDraft | null>(null)
```

- [ ] **Step 3: Add the mutation**

Next to `unexpireMutation`, add:

```ts
  // Complete & Submit — calls /api/admin/drafts/[id]/complete-and-submit.
  // Promotes a payment_on_hold draft into a pending_review application via
  // the shared promoteDraftToApplication() logic (same as Orphan Payments'
  // "Move to pending action" button, triggered from the draft side instead
  // of the payment side).
  const completeAndSubmitMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const res = await fetch(`/api/admin/drafts/${draftId}/complete-and-submit`, { method: "POST" })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; referenceNumber?: string; applicationId?: string }
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "Failed to complete and submit")
      }
      return data as { ok: true; applicationId: string; referenceNumber: string }
    },
    onSuccess: (data) => {
      toast.success(`Submitted for review — reference ${data.referenceNumber}`)
      queryClient.invalidateQueries({ queryKey: ["incomplete-drafts"] })
      queryClient.invalidateQueries({ queryKey: ["incomplete-counts"] })
      // /pending's query key — refreshes if the admin navigates there next
      // in this same tab. Does NOT reach a second tab already open on
      // /pending; that tab needs its own refresh.
      queryClient.invalidateQueries({ queryKey: ["applications"] })
      setCompleteDialogDraft(null)
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to complete and submit")
    },
  })
```

- [ ] **Step 4: Add the button to the `payment_on_hold` actions block**

In `renderActions()`, find the `payment_on_hold` block:

```tsx
    if (draft.status === "payment_on_hold") {
      return (
        <div className="flex items-center gap-1.5">
          {editBtn}
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-400/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 gap-1.5"
            onClick={() => resumeMutation.mutate(draft.id)}
            disabled={pendingResumeId === draft.id}
          >
            {pendingResumeId === draft.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Resume Application
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium text-red-600 dark:text-red-300 border-red-200 dark:border-red-400/30 hover:bg-red-50 dark:hover:bg-red-500/15 gap-1.5"
            onClick={() => setRefundDialogDraft(draft)}
          >
            <CreditCard className="h-3 w-3" />
            Initiate Refund
          </Button>
        </div>
      )
    }
```

Replace with (adds the new button, `super_admin`-gated, before Resume):

```tsx
    if (draft.status === "payment_on_hold") {
      return (
        <div className="flex items-center gap-1.5">
          {editBtn}
          {adminRole === "super_admin" && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 text-xs font-medium text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-400/30 hover:bg-teal-50 dark:hover:bg-teal-500/15 gap-1.5"
              onClick={() => setCompleteDialogDraft(draft)}
            >
              <CheckCircle2 className="h-3 w-3" />
              Complete & Submit
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-400/30 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 gap-1.5"
            onClick={() => resumeMutation.mutate(draft.id)}
            disabled={pendingResumeId === draft.id}
          >
            {pendingResumeId === draft.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Resume Application
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 px-3 text-xs font-medium text-red-600 dark:text-red-300 border-red-200 dark:border-red-400/30 hover:bg-red-50 dark:hover:bg-red-500/15 gap-1.5"
            onClick={() => setRefundDialogDraft(draft)}
          >
            <CreditCard className="h-3 w-3" />
            Initiate Refund
          </Button>
        </div>
      )
    }
```

- [ ] **Step 5: Add the confirm dialog**

Right after the existing `{/* ─── Unexpire Confirmation Dialog ──────────────────────── */}` `<ConfirmDialog>` block, add:

```tsx
      {/* ─── Complete & Submit Confirmation Dialog ─────────────────────── */}
      <ConfirmDialog
        open={!!completeDialogDraft}
        onOpenChange={(o) => { if (!o) setCompleteDialogDraft(null) }}
        title="Complete & submit this application?"
        confirmLabel="Complete & Submit"
        onConfirm={() => completeDialogDraft && completeAndSubmitMutation.mutate(completeDialogDraft.id)}
        isPending={completeAndSubmitMutation.isPending}
      >
        {completeDialogDraft && (
          <div className="space-y-3">
            <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
              <p><span className="font-medium text-muted-foreground">Applicant:</span> {draftDisplayName(completeDialogDraft)}</p>
              <p><span className="font-medium text-muted-foreground">Email:</span> {completeDialogDraft.email}</p>
              <p><span className="font-medium text-muted-foreground">Membership type:</span> {completeDialogDraft.membership_type}</p>
            </div>
            <p>
              This submits the application for manual review. It will never be
              auto-approved — a staff member still has to review and approve
              it in the Pending queue before {draftDisplayName(completeDialogDraft)} becomes a member.
            </p>
          </div>
        )}
      </ConfirmDialog>
```

Note: payment amount is deliberately not shown here — `draft_applications` has no `amount` column, and fetching one just for this confirm dialog would contradict the "no extra fetch needed" design intent. Name, email, and membership type are all already on the loaded draft row.

`ConfirmDialog` (`src/components/ui/confirm-dialog.tsx`) already disables its own confirm button while `isPending`, satisfying the double-click-race requirement without extra code.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/app/incomplete/page.tsx`
Expected: no errors.

- [ ] **Step 7: Manual verification in the browser**

Run: `npm run dev`

As a `super_admin`, navigate to `/incomplete?status=payment_on_hold`:
- Confirm the "Complete & Submit" button appears only for `super_admin` sessions (log in as a plain `admin` and confirm it's absent, matching the existing Edit-button gating pattern).
- Click it, confirm the dialog shows the applicant's name/email/membership type and the "never auto-approved" sentence.
- Click Cancel — dialog closes, no request sent (check network tab).
- Click Complete & Submit against a real `payment_on_hold` test draft with a captured unlinked payment — confirm success toast with reference number, the row disappears from the `payment_on_hold` tab, and the resulting application shows up in `/pending` with `status: pending_review`.
- Re-click Complete & Submit rapidly (or throttle network to Slow 3G and double-click) — confirm the second click is inert while the first is in flight (button visibly disabled).

- [ ] **Step 8: Commit**

```bash
git add src/app/incomplete/page.tsx
git commit -m "$(cat <<'EOF'
feat(incomplete): add Complete & Submit button for payment_on_hold drafts

super_admin-only, mirrors the Resume/Refund/Unexpire button pattern
already on this page. Calls the new complete-and-submit route; confirm
button is disabled in-flight via ConfirmDialog's existing isPending prop.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** §1 → Task 1. §2 → Task 3 (with Task 2 handling the "rewire the existing route" half of §1's closing paragraph). §3 → Task 4. §4's testing plan → the test steps embedded in Tasks 1–3, in the same "characterize the extraction, then build on top" order the spec specifies. §5 (audit trail) → Task 3 Step 3's `logAdminAction()` calls, on both the success and `LINK_FAILED` paths. The "Known related debt" section is explicitly out of scope for this plan (matches the spec's own Non-goals).
- **Deviation from the spec's literal UI text, and why:** §3 says the confirm dialog shows "payment amount — pulled from the draft row already in hand." `draft_applications` has no `amount` column (confirmed against `src/types/database.types.ts`), so this was never actually free — showing it would require a second fetch the spec's own "no extra fetch needed" framing rules out. Task 4 drops payment amount from the dialog body and shows name/email/membership type only, which *are* genuinely already on the loaded row.
- **Behavior-preservation detail not spelled out in the spec, resolved here:** the live route's Sentry captures for `scoring_failed`, `link_failed`, and `draft_soft_complete_failed` all happen on paths that still return `ok: true` (or, for `link_failed`, are part of the discriminated result rather than a thrown error) — so the caller can't re-apply a route-specific Sentry tag after the fact the way it can for the one thrown-and-propagated error. Task 1 resolves this with a `routeTag` field on `PromoteDraftInput`, letting the lib keep making these three captures itself (preserving today's `orphan-payments/promote` tag by passing that same string) while `complete-and-submit` passes its own tag.
- **Control-flow detail not spelled out in the spec, resolved here:** the live route's link (step 5) and soft-complete (step 6) sections run unconditionally for *both* draft and skeleton mode — not only inside the `canReconstruct` branch. Task 2 Step 3 makes this explicit: those two sections stay in the route, now scoped to `mode === "skeleton"` only, since draft mode's version of the same two steps now lives inside `promoteDraftToApplication()`. Missing this would have either double-linked the payment for draft mode or left skeleton-mode payments permanently unlinked.
- **Type consistency:** `PromoteDraftResult`/`PromoteDraftInput` (Task 1) are consumed identically in Task 2 and Task 3 — same field names (`applicationId`, `referenceNumber`, `paymentRowId`, `routeTag`) throughout. The new route's response shapes (Task 3's Interfaces block) match exactly what Task 4's `completeAndSubmitMutation` expects.
- **No placeholders:** every step has real, complete code — no "add validation," no "similar to Task N" without the code repeated in full.

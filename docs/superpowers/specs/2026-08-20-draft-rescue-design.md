# Draft Rescue: Complete & Submit for Payment-on-Hold Drafts

**Date:** 2026-08-20
**Status:** Approved (design), pending implementation

## Problem

An applicant can pay for AMASI membership and then never finish submitting —
network drop, browser crash, closed the tab after Razorpay redirected back.
The payment is real and captured; the application never gets created. Today
the only recovery path is `/incomplete`'s "Resume Application" button, which
emails the applicant asking them to log back in and finish themselves. If
they don't (lost the email, moved on, forgot), the application just sits at
`payment_on_hold` indefinitely with no way for staff to close the loop
without asking the applicant to act.

This was originally scoped as a much bigger "Draft Rescue module" — a new
`/admin/drafts` page mocked up with full document/OCR review, inline editing,
and a "Fix & Resubmit" flow. Investigation before writing this spec found
that most of that already exists on `/incomplete` (list, filter by
status/stage/fault, search, send reminder, delete, refund, unexpire, and a
9-field identity edit dialog) and that a second existing route,
`/api/admin/orphan-payments/promote`, already implements the exact
"reconstruct a full application from a draft's data, score it, submit to
`pending_review`" logic this needs — just triggered from a different
starting point (an orphaned payment row, not a draft directly).

**Session-level note:** the 24h hard-delete policy shipped earlier in this
project (draft cleanup cron) already narrowed what "rescue" can mean. Unpaid
abandoned drafts are now permanently deleted at 24h — the `unexpire` route
can no longer act on them (it only restores `status='expired'`, which is now
reachable only via the refund-completion path). Rescue is only meaningful for
drafts that still exist: `stuck` (within the 24h window, blocked by a
document/data problem, no payment) or `payment_on_hold` (payment captured,
application never finished). This spec covers only the second case.

## Non-goals (explicitly out of scope for this spec)

- **A new `/admin/drafts` page.** `/incomplete` already covers list/filter/
  search/basic actions; duplicating it would be pure waste.
- **Document/OCR data editing for `stuck` (unpaid) drafts.** Fixing a bad
  document doesn't rescue anything by itself — payment still has to happen,
  by the applicant. This is a real gap (tracked as a follow-up) but it's an
  extension of the existing edit-fields dialog, not a submission flow, and
  is a separate piece of work.
- **Admin-assisted apply** (staff creating a brand-new application on an
  applicant's behalf, phone/in-person, from scratch — "Screen B" in the
  original mockup). Separate sub-project.
- **Changing `/api/admin/orphan-payments/promote`'s own behavior or UI.**
  It keeps working exactly as it does today; this spec only extracts its
  reconstruction logic so a second caller can reuse it.

## Solution Overview

1. Extract the draft-reconstruction logic already living inside
   `/api/admin/orphan-payments/promote/route.ts` into a shared function,
   `promoteDraftToApplication()`, in a new `src/lib/promote-draft-to-application.ts`.
2. Add a new endpoint, `POST /api/admin/drafts/[id]/complete-and-submit`,
   that loads a `payment_on_hold` draft directly (by draft id, not payment
   id), verifies it has a linked paid payment, and calls the shared function.
3. Add a "Complete & Submit" button to `/incomplete`'s `payment_on_hold` row
   actions (super_admin-only, alongside the existing Resume/Refund/Edit
   buttons), with a one-click confirm dialog.
4. Rewire `/api/admin/orphan-payments/promote/route.ts` to call the same
   shared function for its draft-mode branch, so there is exactly one
   implementation of "build an application from a draft and submit it,"
   not two.

The result: an application built this way is **always** `pending_review`
(or `documents_unreadable` if the AI can't even parse the docs) — never
auto-approved. A human reviews it in `/pending` exactly like any other
application, same as `/admin/orphan-payments/promote` already guarantees
today.

---

## 1. `src/lib/promote-draft-to-application.ts`

Extracted from `orphan-payments/promote/route.ts` lines ~204–282 (the
`canReconstruct` / draft-mode branch), unchanged in behavior:

```ts
export interface PromoteDraftInput {
  draft: DraftApplicationRow          // full draft_applications row
  email: string                        // lowercased, trimmed
  paymentId: string                    // gateway_payment_id (pay_...)
  actorReason: string                  // human-readable reason string, stored on the row
}

export interface PromoteDraftResult {
  applicationId: string
  referenceNumber: string
}

export async function promoteDraftToApplication(
  input: PromoteDraftInput,
  supabase: SupabaseClient,
): Promise<PromoteDraftResult>
```

Behavior (identical to what `orphan-payments/promote` does today, just
callable from elsewhere):

1. Score the draft's `step_data.formData` + `step_data.uploads` via
   `scoreApplication()`. On scoring failure, fall back to a neutral
   `fallbackApproval()` result — scoring is informational here, never
   gating; the row is going to `pending_review` regardless.
2. Determine `applicationStatus`: `"documents_unreadable"` if the AI
   flagged that, otherwise **always** `"pending_review"` — this function
   never returns an auto-approved status, by construction.
3. Build the row via the existing `buildApplicationRow()` helper
   (`allAiVerified: false` is hardcoded — this path never auto-approves,
   regardless of what the score says).
4. Finalize an existing `pending_payment` skeleton row in place if one
   exists for this email (same idempotent-finalize pattern as today);
   otherwise insert fresh.
5. Link the payment: `membership_payments.application_id = <new id>`,
   guarded by `.is("application_id", null)` so a race can't double-link.
6. Soft-complete the source draft (`status: "completed"`, `deleted_at`
   set, `step_data.recovered_application_id` recorded) — same as today.
7. Returns `{applicationId, referenceNumber}`. Does **not** write the
   audit log entry — callers do that themselves, since the two call sites
   have different actor context and audit action names (see §3).

`orphan-payments/promote/route.ts` is rewritten to call this function for
its draft-mode branch instead of inlining the logic — its skeleton-mode
branch, all of its pre-checks (already-linked, already-exists, no-identity),
and its own response shape are untouched.

---

## 2. New route: `POST /api/admin/drafts/[id]/complete-and-submit`

Auth: `getAdminSession()` + `session.adminRole === "super_admin"` — same
gate as `unexpire` and `edit-fields` in this same file family.

```
Request:  POST /api/admin/drafts/{draftId}/complete-and-submit
Response: { ok: true, applicationId, referenceNumber }
       or { ok: false, error: string }, appropriate status code
```

Flow:

1. Load the draft (`id, email, status, step_data`). 404 if not found.
2. **409** if `status !== "payment_on_hold"` — this action only applies
   to that status; message states the actual status.
3. Look up the linked payment: `membership_payments` where
   `member_email = draft.email` (case-insensitive) and `status = 'paid'`,
   most recent by `created_at`. **422** if none found — `payment_on_hold`
   should always have one (it's how the draft got into this status via
   the cleanup cron / webhook), but this is checked defensively rather
   than assumed.
4. **409 `ALREADY_EXISTS`** if an application already exists for this
   email at any status other than `pending_payment` — mirrors the
   idempotency check already in `orphan-payments/promote`. Response
   includes the existing `applicationId`/`referenceNumber` so the UI can
   show "already submitted" instead of a bare error.
5. `canReconstruct` check: `step_data.formData` and `step_data.uploads`
   must both be present. **422** if not (shouldn't happen for a draft
   that reached `payment_on_hold` — reaching the payment step requires
   having filled the form and uploaded documents — but checked rather
   than assumed; message explains this is unexpected and to reconcile
   manually).
6. Call `promoteDraftToApplication()`.
7. **500 `LINK_FAILED`** (surfaced loudly, not swallowed) if the
   application was created but the payment-link update failed —
   mirrors the existing route's handling of this exact failure mode.
8. On success: `logAdminAction()` — `action: "draft_complete_and_submit"`,
   `entityType: "application"`, `entityId: <new applicationId>`,
   `details: {draftId, referenceNumber, paymentId, email}`.
9. Return `{ok: true, applicationId, referenceNumber}`.

Reason string passed into `promoteDraftToApplication`: auto-generated,
mirroring the existing route's pattern — e.g. `"Completed from stuck
payment_on_hold draft by {actorEmail}: applicant paid ₹{amount}
({paymentId}) but never finished submitting. Promoted from their saved
draft data. Routed to manual review; verify before approving."` No
free-text reason field in the UI — matches the existing one-click
`orphan-payments/promote` pattern, not the more ceremonial flow from the
original mockup.

---

## 3. UI: `/incomplete` page changes

In `renderActions()` for `draft.status === "payment_on_hold"`, add a third
button next to the existing Resume/Refund pair, gated the same way the
existing `editBtn` is (`adminRole === "super_admin"`):

```
[Edit] [Complete & Submit] [Resume Application] [Initiate Refund]
```

Clicking opens a confirm dialog (new, styled like the existing
Refund/Delete/Unexpire `ConfirmDialog`/`Dialog` usages already on this
page):

- Title: "Complete & submit this application?"
- Body: applicant name (via the existing `draftDisplayName()` helper),
  email, membership type, payment amount — pulled from the draft row
  already in hand, no extra fetch needed.
- Explicit line: **"This submits the application for manual review. It
  will never be auto-approved — a staff member still has to review and
  approve it in the Pending queue before {name} becomes a member."**
- Confirm button → `POST .../complete-and-submit`. On success: toast
  showing the new reference number, invalidate `incomplete-drafts` +
  `incomplete-counts` queries (the row disappears from `payment_on_hold`
  since the draft is now `completed`), and — new — invalidate whatever
  query key `/pending` uses so the new `pending_review` row shows up
  there without a manual refresh if an admin has both tabs open.
- On `ALREADY_EXISTS` (409): don't show a raw error — show "This
  applicant already has an application ({reference number})" with a
  link/reference the admin can act on instead.
- On other errors: existing toast-error pattern, matching every other
  mutation on this page.

No new page, no new route in the Next.js sense — this is entirely
additive to the existing `/incomplete` page and its existing dialog
patterns.

---

## 4. Testing plan

**The extraction is the risky part of this spec, not the new route.**
Pulling the `canReconstruct` branch out of `orphan-payments/promote`
touches a live path that real applicants and real captured payments flow
through today. The new endpoint is greenfield — if it has a bug, it fails
closed (nothing happens, an admin retries). If the extraction changes
behavior, it can regress a working recovery path in a way nobody notices
until the next orphan payment needs it.

**Confirmed while writing this spec: `orphan-payments/promote` currently
has zero test coverage** (`grep -rl "orphan-payments/promote" __tests__/`
returns nothing). So this isn't "extract, then add tests as a formality"
— the tests written for `promoteDraftToApplication()` are the *first*
tests this logic will ever have, and they need to characterize the
existing live behavior first, before anything is wired to a second
caller. Order of work:

1. Write `__tests__/promote-draft-to-application.test.ts` against the
   function *as extracted* (pure relocation, zero logic changes — same
   discipline as the `cleanup-drafts.ts` extraction earlier this
   session), asserting the behavior `orphan-payments/promote` has today:
   - Happy path: valid draft with formData+uploads → scores, builds the
     row via `buildApplicationRow()`, inserts, links the payment,
     soft-completes the draft, returns `{applicationId, referenceNumber}`.
   - Finalizes an existing `pending_payment` skeleton row in place
     instead of inserting fresh, when one exists for the email — this is
     existing, load-bearing behavior (handles the WS-C early-application
     case), not new.
   - Scoring throws → falls back to the neutral `fallbackApproval()`
     result, still succeeds, still lands on `pending_review` (never
     blocks on scoring availability) — matches today's behavior exactly.
   - `documents_unreadable` decision from the scorer → `applicationStatus`
     is `"documents_unreadable"`, not `"pending_review"` — matches today.
   - Payment-link update failing after a successful insert → the
     function surfaces this rather than silently succeeding (exact
     return shape TBD during implementation — likely a distinguishable
     error/result variant), matching the existing route's current
     "created but LINK_FAILED" handling.
   - **Never produces `allAiVerified: true` / an auto-approved status
     under any input** — the one invariant this whole feature exists to
     guarantee. Gets its own explicit assertion regardless of which other
     case it's checked alongside.
2. Run `npx tsc --noEmit && npx eslint` on the rewritten
   `orphan-payments/promote/route.ts` and the full `vitest` suite —
   confirm nothing else in the repo assumed the old inline shape.
3. Manually re-verify `orphan-payments/promote`'s own behavior against
   its documented contract (its own file-header comment lists the two
   modes and their guarantees) — read the rewritten route side-by-side
   with the pre-extraction version and confirm every branch, response
   shape, and status code is identical, not just "the tests pass."
4. Only then build the new route on top.

Route-level (`__tests__/complete-and-submit.test.ts`), lighter — this
route is mostly auth/status-gating glue around the already-tested lib
function:

- 401/403 for non-admin / non-super_admin.
- 409 for wrong draft status, with the actual status in the message.
- 422 for no linked paid payment.
- 409 `ALREADY_EXISTS` short-circuits before calling the promotion logic.
- Happy path calls through and returns `{ok:true, applicationId,
  referenceNumber}`.

Full `vitest` suite green before and after the extraction commit, same
verification bar as every other change this session — the extraction and
the new route should ideally land as **separate commits**, so the risky
part (extraction) can be reviewed and, if needed, reverted independently
of the new, lower-risk endpoint built on top of it.

---

## 5. Audit trail

Two distinct audit actions end up recorded for the same underlying
mechanism, matching how the codebase already treats these as separate
operator-facing events:

- Via `/incomplete`: `logAdminAction()`, `action: "draft_complete_and_submit"`.
- Via Orphan Payments (existing, unchanged): `logAdminAction()`,
  `action: "orphan_payment_promote_to_pending"`.

Both ultimately produce a `membership_applications` row whose creation is
also automatically captured by the existing `log_membership_changes()` DB
trigger into `membership_audit_log` (row-level insert), same as any other
application insert.

---

## Known related debt — out of scope here, tracked so it doesn't go silent

Two things surfaced while scoping this spec that this work does **not**
fix. Recording them explicitly rather than leaving them as something only
this conversation remembers:

- **`unexpire` (`/api/admin/drafts/[id]/unexpire`) is now largely dead
  code.** It restores a draft from `status='expired'` back to
  `in_progress`. Before the 24h hard-delete policy shipped, that's how
  every unpaid-and-abandoned draft eventually landed (soft-deleted,
  restorable). Now, unpaid drafts are **hard-deleted** at 24h — the row
  is gone, there is nothing left to unexpire. The *only* remaining path
  that still produces a `status='expired'` row is refund completion
  (`cleanup-drafts.ts` Step 5), a materially different and much rarer
  scenario than what this route was built for. The route still works
  correctly for that narrow case; it's not broken, just no longer doing
  the job it was written for. Nobody has removed the "Unexpire" button
  from `/incomplete`'s expired-tab actions, so it's still visibly offered
  to admins for a population that (going forward) will almost never
  exist. Follow-up: either repurpose/rename it to be explicit about the
  refund-only scope it now actually has, or remove it if that scope isn't
  worth a dedicated button. Not addressed in this spec.

- **Scenario B — document/OCR fixing for `stuck` (unpaid) drafts — has
  no owner yet.** Flagged as a Non-goal above, repeating here so it
  doesn't quietly disappear: this is real, still-valuable work (extend
  the existing 9-field edit-fields dialog to also show/fix document data,
  so a `stuck` draft blocked by a bad OCR read or a missing document can
  actually be un-blocked by staff before the applicant is asked to act).
  It doesn't submit anything by itself — payment still has to happen,
  by the applicant — which is exactly why it's a separate, smaller
  follow-up rather than part of this spec.

- **Admin-assisted apply from scratch ("Screen B")** — staff creating a
  brand-new application on an applicant's behalf (phone/in-person). A
  separate sub-project, not started, not addressed here.

- **`unexpire`'s own header comment** references a planned "Phase 3:
  link-to-member" that was never built and that this spec does not
  address either — revisit only if it's still wanted; it may be
  fully superseded by `/admin/orphan-payments` at this point.

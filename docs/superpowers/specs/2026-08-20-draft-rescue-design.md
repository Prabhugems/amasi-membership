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
`canReconstruct` / draft-mode branch) — re-verified against the exact
current control flow (not from memory) while incorporating review
feedback below, so this section now pins the real branches instead of
leaving one open:

```ts
export type PromoteDraftResult =
  | { ok: true; applicationId: string; referenceNumber: string }
  | { ok: false; code: "ALREADY_EXISTS_RACE"; message: string }
  | { ok: false; code: "LINK_FAILED"; applicationId: string; referenceNumber: string; message: string }

export interface PromoteDraftInput {
  draft: DraftApplicationRow          // full draft_applications row
  email: string                        // lowercased, trimmed
  paymentId: string                    // gateway_payment_id (pay_...)
  paymentRowId: string                 // membership_payments.id — needed for the link update in step 5
  actorReason: string                  // human-readable reason string, stored on the row
}

export async function promoteDraftToApplication(
  input: PromoteDraftInput,
  supabase: SupabaseClient,
): Promise<PromoteDraftResult>
// Throws only for genuinely unexpected errors (anything that isn't the
// specific 23505 race handled below) — callers wrap the call in their own
// try/catch and apply their own route-specific Sentry tags on that path,
// same as orphan-payments/promote does today for its "Failed to create
// application" 500 branch. This function does not call Sentry itself.
```

Behavior — **every branch below is the exact current behavior of
`orphan-payments/promote`, re-read line-by-line from the live file, not
reconstructed from memory:**

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
   exists for this email; otherwise insert fresh.
   - If a skeleton existed but the finalize-update matches 0 rows (lost a
     race to another writer that finalized it first): **return**
     `{ok: false, code: "ALREADY_EXISTS_RACE", message: "Application was
     just finalized elsewhere."}` — no `applicationId` in this branch,
     because none was created by *this* call. (The pre-existing
     application from the winning writer is what actually exists; this
     function doesn't look it up to return its id — matches today, where
     the route also doesn't include one in this specific response.)
   - If the insert/update itself throws a Postgres `23505` (the
     `idx_unique_active_application` partial unique index rejecting a
     second active application for this email+type): caught internally,
     **return** `{ok: false, code: "ALREADY_EXISTS_RACE", message: "An
     active application already exists for this applicant."}` — same
     code, different message, matching the two textually-distinct
     messages the current route produces for these two different race
     shapes. Any other thrown error is **not** caught here — it
     propagates to the caller, matching today's generic-500 path.
   - **Verified, not assumed: both race shapes return 409 today.** The
     lost-finalize-race branch returns 409 inline at
     `orphan-payments/promote/route.ts:266-271`, before the `try` block's
     `catch` is ever reached. The `23505` branch is caught explicitly at
     lines 315-324 and *also* returns 409 — it does not fall through to
     the generic `catch`'s 500 branch below it (that 500 only fires for
     errors that are **not** `23505`). So collapsing both into one
     `ALREADY_EXISTS_RACE` → 409 mapping is a pure extraction: it changes
     no status code that exists today. If this ever needs re-verifying
     after a future edit to the live route, re-check those two line
     ranges before trusting this claim.
5. **Link the payment**: `membership_payments.application_id = <new
   id>`, guarded by `.eq("id", paymentRowId).is("application_id", null)`
   so a race can't double-link.
   - **On link failure: return immediately —
     `{ok: false, code: "LINK_FAILED", applicationId, referenceNumber,
     message: "Application created but payment link failed. Please
     retry."}` — and do NOT proceed to step 6.** This is the exact
     ordering the live code already has (the `return` on the link-error
     branch happens textually before the soft-complete block) — the
     application exists, unlinked, and the draft is deliberately left
     alone at `payment_on_hold` so it's still visible on `/incomplete`
     for an admin to see and retry from, rather than disappearing into
     an unreachable state. This was the one behavior worth stating
     explicitly rather than leaving implicit in prose, since it's the
     exact failure mode this whole feature exists to prevent.
6. Soft-complete the source draft (`status: "completed"`, `deleted_at`
   set, `step_data.recovered_application_id` recorded) — **only reached
   if step 5 succeeded.**
7. Return `{ok: true, applicationId, referenceNumber}`.

This function does **not** write the audit log entry — callers do that
themselves, since the two call sites have different actor context and
audit action names (see §5).

`orphan-payments/promote/route.ts` is rewritten to call this function for
its draft-mode branch instead of inlining the logic, translating each
`PromoteDraftResult` variant to the exact same response shape/status code
it already returns today. Its skeleton-mode branch, all of its pre-checks
(already-linked, already-exists-by-payment, already-exists-by-email,
no-identity), and its own response shape are untouched.

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
   `member_email = draft.email` (case-insensitive), `status = 'paid'`,
   **and `application_id IS NULL`**, most recent by `created_at`.
   **422** if none found. The `application_id IS NULL` clause is load-
   bearing, not optional: `member_email` + `status='paid'` alone isn't a
   unique key — a renewal, a retry, or any other paid row for the same
   email would let a *linked* payment win the sort, which the lib's own
   `.is("application_id", null)` guard in step 5 would then reject —
   but only *after* the application row is already inserted, landing in
   `LINK_FAILED` instead of a clean pre-flight rejection. Filtering for
   unlinked here means "no unlinked paid payment" fails at 422, before
   anything is created, which is the actual guarantee this check exists
   to provide.
4. **409 `ALREADY_EXISTS`** if an application already exists for this
   email at any status other than `pending_payment` or `rejected`.
   Response includes the existing `applicationId`/`referenceNumber` so
   the UI can show "already submitted" instead of a bare error.

   **Decided, not deferred:** the existing `orphan-payments/promote`
   route excludes only `pending_payment`, but this check lives in the
   *route* (step 4 here), not inside `promoteDraftToApplication()` — so
   this new route can exclude `rejected` too with zero blast radius on
   `orphan-payments/promote`, which keeps its own behavior unchanged.
   The case this matters for is exactly the one this feature exists to
   serve: a previously-rejected applicant who legitimately re-applies
   and pays again has no other recovery path today (admin-assisted apply
   doesn't exist — see Non-goals), so without this exclusion they'd hit
   a hard 409 pointing at their old rejected application with no
   workaround. `checkDuplicateApplication()` elsewhere in the codebase
   already excludes `rejected` from its own duplicate check, so this
   aligns with that precedent rather than inventing a new rule. Aligning
   `orphan-payments/promote`'s own check the same way is a separate,
   optional follow-up — not required by or blocking this spec.
5. `canReconstruct` check: `step_data.formData` and `step_data.uploads`
   must both be present. **422** if not (shouldn't happen for a draft
   that reached `payment_on_hold` — reaching the payment step requires
   having filled the form and uploaded documents — but checked rather
   than assumed; message explains this is unexpected and to reconcile
   manually).
6. Call `promoteDraftToApplication({draft, email, paymentId: payment.gateway_payment_id, paymentRowId: payment.id, actorReason})`.
7. Map the result:
   - `{ok: true, ...}` → `logAdminAction()` (see step 8), return
     `{ok: true, applicationId, referenceNumber}`.
   - `{ok: false, code: "ALREADY_EXISTS_RACE", message}` → **409**,
     same code, pass the message through as-is. No audit entry — no
     application was created by this call, nothing to attribute.
   - `{ok: false, code: "LINK_FAILED", applicationId, referenceNumber, message}`
     → **500**, same code, pass `applicationId` through in the response
     so the admin-facing error can reference it (the application *was*
     created — see §1 step 5 for why the draft is deliberately left
     untouched at `payment_on_hold` rather than soft-completed here).
     **Also `logAdminAction()`** (see step 8) — this is the one failure
     mode that requires a human to manually reconcile, and it's the one
     with the most to lose from having no record of which admin
     triggered it. Without an audit row here, whoever reconciles this
     later has no way to see who ran the action or which payment it was
     meant to link.
   - Anything thrown (not one of the above) → caught, `Sentry.captureException`
     with this route's own tags, generic **500**. No audit entry — no
     application was created.
8. `logAdminAction()` — fires on **both** the success path and the
   `LINK_FAILED` path (not "success only"):
   - Success: `action: "draft_complete_and_submit"`, `entityType:
     "application"`, `entityId: <new applicationId>`, `details:
     {draftId, referenceNumber, paymentId, email}`.
   - `LINK_FAILED`: same `action` and `entityType`, `entityId: <new
     applicationId>` (it exists even though unlinked), `details:
     {draftId, referenceNumber, paymentId, email, linkFailed: true,
     paymentRowId}` — the extra `linkFailed` flag and `paymentRowId`
     give whoever reconciles this the actor, the payment row to
     re-link, and the application id in one audit entry instead of
     having to cross-reference Sentry.

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
- Confirm button is **disabled while the mutation is in flight**
  (`mutation.isPending`), same pattern already used for every other
  mutation button on this page (Refund/Delete/Unexpire). Without this, two
  fast clicks can both read the pre-mutation state, both pass the route's
  `ALREADY_EXISTS` pre-check before either insert lands, and race each
  other into the `23505` path — survivable (the lib returns
  `ALREADY_EXISTS_RACE` cleanly for the loser), but there's no reason to
  let two identical submits fire when disabling one button prevents it.
- Confirm button → `POST .../complete-and-submit`. On success: toast
  showing the new reference number, invalidate `incomplete-drafts` +
  `incomplete-counts` queries (the row disappears from `payment_on_hold`
  since the draft is now `completed`), and — new — invalidate whatever
  query key `/pending` uses too. **Scope note:** React Query cache
  invalidation is per-tab, not cross-tab — this only guarantees the
  `/pending` list is fresh if the admin later navigates there *in this
  same browser tab*, e.g. via an in-app link/router push after the
  toast. It does nothing for a second browser tab already sitting on
  `/pending`; that tab still needs a manual refresh or its own
  polling/refetch-on-focus to pick up the new row.
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
   session), asserting the exact branches pinned in §1 above — the
   return shape is no longer an open question, so every case below
   asserts a specific, named result variant:
   - Happy path: valid draft with formData+uploads → scores, builds the
     row via `buildApplicationRow()`, inserts, links the payment,
     soft-completes the draft, returns
     `{ok: true, applicationId, referenceNumber}`.
   - Finalizes an existing `pending_payment` skeleton row in place
     instead of inserting fresh, when one exists for the email — this is
     existing, load-bearing behavior (handles the WS-C early-application
     case), not new.
   - Scoring throws → falls back to the neutral `fallbackApproval()`
     result, still succeeds, still lands on `pending_review` (never
     blocks on scoring availability) — matches today's behavior exactly.
   - `documents_unreadable` decision from the scorer → `applicationStatus`
     is `"documents_unreadable"`, not `"pending_review"` — matches today.
   - Finalize-race lost (skeleton existed, update matched 0 rows) →
     `{ok: false, code: "ALREADY_EXISTS_RACE", message: "Application was
     just finalized elsewhere."}` — no `applicationId`.
   - Insert throws Postgres `23505` → caught internally, returns
     `{ok: false, code: "ALREADY_EXISTS_RACE", message: "An active
     application already exists for this applicant."}` — same code,
     the other message, asserted as a *distinct* case from the one above
     so a future change can't quietly collapse the two messages into one
     without a test noticing.
   - Insert throws anything else → propagates (the function does not
     swallow it) — asserted by checking the call rejects, not that it
     returns a value.
   - **Payment-link update fails after a successful insert →
     `{ok: false, code: "LINK_FAILED", applicationId, referenceNumber,
     message: "Application created but payment link failed. Please
     retry."}` — AND the draft's soft-complete update
     (`draft_applications.update`) is asserted to never have been
     called in this case.** This is the specific regression the design
     review caught: soft-completing on link failure would make the
     application invisible-and-unlinked with no admin-visible trace.
     The test exists specifically to keep that from happening silently
     in a future edit.
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
- **422 specifically when the only paid payment row for this email is
  already linked to a different application** (`application_id` set) —
  the case the `.is("application_id", null)` filter exists to catch.
  Without this test, a future edit could drop that clause and the
  regression would only surface as an occasional `LINK_FAILED` in
  production, not a failing test.
- 409 `ALREADY_EXISTS` short-circuits before calling the promotion logic
  — for an existing application at any status **other than
  `pending_payment` or `rejected`**.
- **A `rejected` existing application does NOT trigger `ALREADY_EXISTS`**
  — falls through to the promotion logic instead. This is the specific
  behavior change from `orphan-payments/promote` (which excludes only
  `pending_payment`) that this test locks in, so a future edit can't
  accidentally revert this route back to matching the old route's
  narrower exclusion.
- 409 when the lib returns `ALREADY_EXISTS_RACE`, message passed
  through, **and no `logAdminAction()` call**.
- 500 `LINK_FAILED` when the lib returns that variant, `applicationId`
  passed through in the response body, **and `logAdminAction()` is
  called with `details.linkFailed: true` and `details.paymentRowId`
  set** — this is the audit-trail gap the design review caught; the
  test exists so a future edit can't silently drop the LINK_FAILED
  audit call the way the original draft of this spec did.
- Happy path calls through, returns `{ok:true, applicationId,
  referenceNumber}`, and `logAdminAction()` is called without
  `linkFailed` in its details.

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

# Backlog — tracked tech debt and follow-ups

One-line items per row. Each entry has: date added, area, owner (optional), short description, link to context.

| Added | Area | Description | Context | Deadline |
|---|---|---|---|---|
| 2026-04-26 | lint / types | 29 pre-existing `@typescript-eslint/no-explicit-any` errors in `src/app/api/payments/verify/route.ts` (6), `src/app/api/payments/create-order/route.ts` (6), `src/app/apply/page.tsx` (17). Surfaced when fix #4 (`d3e4011`) was bypassed via `--no-verify`. **Two-step fix:** (a) tomorrow morning: switch `lint-staged` to diff-only (e.g. via `lint-staged-eslint-diff`) so unrelated commits to these files don't get blocked; (b) this date: clean the 29 errors so the hook stays honest. `apply/page.tsx` is the top fragile file (24 fix commits, 2,985 LOC) — debt cleanup compounds with the planned state-machine extraction. | fix #4 commit `d3e4011`; pre-commit hook in `.husky/pre-commit`; audit §6.2 | **2026-05-10** |
| 2026-04-26 | infra / kill-switch | `MAINTENANCE_MODE` is a `NEXT_PUBLIC_*` env, baked into the bundle at build time (`c0c5feb`). Toggling requires a full Vercel redeploy. Move to a runtime gate: server component reading `process.env.MAINTENANCE_MODE` (no `NEXT_PUBLIC_` prefix) or a Supabase row in `app_config`. Lets you flip the kill-switch in seconds when needed. | `c0c5feb feat(apply): add MAINTENANCE_MODE env gate`; `src/app/apply/page.tsx` `ApplyPage` shell | **2026-05-17** |
| 2026-04-29 | lint / types | `src/lib/document-extraction.ts` has 13 pre-existing `@typescript-eslint/no-explicit-any` errors + 5 warnings (4 `security/detect-unsafe-regex`, 1 unused `isJPEG`) concentrated in the OCR.space fallback regex code (lines 255–677 pre-change). The `any` types are on Anthropic SDK response shapes; the unsafe-regex warnings are on the fallback name/year extractors. PR #1 (prompt update) used `--no-verify` to bypass the pre-commit hook because all errors pre-existed and were unrelated to the prompt change. Blocks future commits to this file from having clean hooks. **Likely auto-resolved** when the 2026-04-26 row above ships `lint-staged-eslint-diff` (deadline 2026-05-10); if not, this file needs its own dedicated cleanup PR (annotate Anthropic SDK response shapes properly; eslint-disable the constrained-input regexes with comments). Not urgent. | commit `d401b21`; `.husky/pre-commit`; row above | (resolved by row above; otherwise dedicated PR) |

## Security: Add BotID Bot Protection

**Status:** Half-implemented attempt was abandoned (reverted before merge, 2026-04-27).

**Need:**
- `withBotId()` wrapper in `next.config.ts`
- `checkBotId()` in payment / auth / submit routes
- Migrate to Next.js 15.3+ pattern: use `initBotId()` in `instrumentation-client.ts` (NOT `<BotIdClient/>` in `layout.tsx`)
- Test in Vercel preview deployment before merging

**Critical paths to protect:**
- `/api/payments/create-order`
- `/api/auth/login`
- `/api/applications/submit`

## Data integrity
- Kumar Kaushik (members #18263) — membership_applications.member_id is null despite members row existing with application_no='AMASI-2026-F1A29BDA64'. Back-link not populated at member creation. Fix: backfill query to populate member_id on application row from members.application_no match. Not urgent.

## Storage architecture
- `uploads` bucket is `public=true` — any URL holder can access documents. Migration to private + signed URLs is Phase B work.
- Two storage path patterns exist (`uploads/{docType}/...` from OCR route, `uploads/applications/{id}/...` from resubmit route). Schema unification needed.
- OCR pipeline does not persist a confidence score. If auto-approval-by-confidence is ever needed, schema change required.

## OCR field extraction
- OCR cron logs "Name mismatch" on the document with the CORRECT reading rather than the broken one. This is a misleading flag — admin reviewing the queue will think the document the flag is attached to is the problem document, when in fact it's the OK one. Fix: log the warning against the document with the broken/missing read, not the good one. Discovered 2026-04-26 during Puneet Agrawal email drafting (his ASI cert read `"DR. PUNEET AGRAWAL"` correctly but carried the warning; the actual broken read was `"of Dr"` on his MCI cert). Not urgent — operational quirk only.

## OCR-failure handling improvement

**Current:** OCR-failed documents are discarded entirely. User must re-upload from scratch. Some legitimate documents fail OCR due to lighting/angle/glare and frustrate users.

**Proposed:** OCR-failed documents stored in `uploads/pending_review/{docType}/` with `status='pending_admin_review'`. Admin queue surfaces these. Admin must explicitly view the document image (with confirmation checkbox) before approving manually. All manual approvals logged with admin user_id, timestamp, and document URL.

**Benefits:**
- Fewer legitimate doctors blocked by OCR limitations
- Complete audit trail of all submitted documents
- Maintains today's payment-validation gate (fix #4)

**Risks:**
- Storage cost increase (~5–10% more files)
- Admin workload increase
- Re-introduces manual approval risk if not properly gated

**Estimated implementation:** 1–2 days. Should be done **after** the incomplete-applications cleanup feature ships.

## Funnel: post-OTP draft progression

Discovered 2026-04-26 during Issue 3 investigation for the cleanup-cron rewrite. Of 36 stale step-2 drafts, **30 had successfully verified at least one OTP** (83% — higher than the 67% baseline across all OTP-using emails) and yet `current_step` never advanced past 2. Many of these post-date commit `8855294` (23-Apr fix for *"95% trapped at step-2 OTP loop"*), so either the fix didn't fully cover this case OR there's a separate post-verify-don't-progress bug. UX investigation: trace `saveDraftToServer(3)` invocation post-OTP-verify in `apply/page.tsx`; confirm `current_step=3` actually gets persisted before the user navigates away. Not blocking the cleanup cron (these are real abandoned drafts; reminders + soft-delete are appropriate) but worth its own session. Not urgent.

## Observability: OTP send pipeline has no audit log

`/api/otp/send` writes to `otp_codes` (the verification record) but does NOT write to `email_logs`, `communication_logs`, or `message_logs`. Those tables are populated by ticket / event / communication-template flows but not the OTP path. Result: cannot reconstruct from DB whether an OTP email actually delivered to inbox vs bounced vs spam-filtered — only that the API call succeeded enough to insert a row. Surfaced 2026-04-26 when investigating the 6 stale drafts that never verified an OTP. Fix: write an `email_logs` row on every OTP send with the Resend message_id, status, and any provider response. Helpful for any future delivery-debugging. Not urgent.

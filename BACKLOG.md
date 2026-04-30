# Backlog — tracked tech debt and follow-ups

One-line items per row. Each entry has: date added, area, owner (optional), short description, link to context.

## TOP PRIORITY — active block

**FIX: `checkSnapshotTable()` in `scripts/backfill-email-verified-2026-04-30.ts` fails open.** When table is missing, supabase-js returns `{count: null}`, which the script's `count ?? 0` converts to "exists with 0 rows". Fix: require count to be a finite number (`typeof === 'number'`) for `exists=true`. Add debug log of error shape for future diagnosability. Discovered 2026-04-30 during dry-run; backfill blocked until fix lands.

| Added | Area | Description | Context | Deadline |
|---|---|---|---|---|
| 2026-04-26 | lint / types | 29 pre-existing `@typescript-eslint/no-explicit-any` errors in `src/app/api/payments/verify/route.ts` (6), `src/app/api/payments/create-order/route.ts` (6), `src/app/apply/page.tsx` (17). Surfaced when fix #4 (`d3e4011`) was bypassed via `--no-verify`. **Two-step fix:** (a) tomorrow morning: switch `lint-staged` to diff-only (e.g. via `lint-staged-eslint-diff`) so unrelated commits to these files don't get blocked; (b) this date: clean the 29 errors so the hook stays honest. `apply/page.tsx` is the top fragile file (24 fix commits, 2,985 LOC) — debt cleanup compounds with the planned state-machine extraction. | fix #4 commit `d3e4011`; pre-commit hook in `.husky/pre-commit`; audit §6.2 | **2026-05-10** |
| 2026-04-26 | infra / kill-switch | `MAINTENANCE_MODE` is a `NEXT_PUBLIC_*` env, baked into the bundle at build time (`c0c5feb`). Toggling requires a full Vercel redeploy. Move to a runtime gate: server component reading `process.env.MAINTENANCE_MODE` (no `NEXT_PUBLIC_` prefix) or a Supabase row in `app_config`. Lets you flip the kill-switch in seconds when needed. | `c0c5feb feat(apply): add MAINTENANCE_MODE env gate`; `src/app/apply/page.tsx` `ApplyPage` shell | **2026-05-17** |
| 2026-04-29 | lint / types | `src/lib/document-extraction.ts` has 13 pre-existing `@typescript-eslint/no-explicit-any` errors + 5 warnings (4 `security/detect-unsafe-regex`, 1 unused `isJPEG`) concentrated in the OCR.space fallback regex code (lines 255–677 pre-change). The `any` types are on Anthropic SDK response shapes; the unsafe-regex warnings are on the fallback name/year extractors. PR #1 (prompt update) used `--no-verify` to bypass the pre-commit hook because all errors pre-existed and were unrelated to the prompt change. Blocks future commits to this file from having clean hooks. **Likely auto-resolved** when the 2026-04-26 row above ships `lint-staged-eslint-diff` (deadline 2026-05-10); if not, this file needs its own dedicated cleanup PR (annotate Anthropic SDK response shapes properly; eslint-disable the constrained-input regexes with comments). Not urgent. | commit `d401b21`; `.husky/pre-commit`; row above | (resolved by row above; otherwise dedicated PR) |
| 2026-04-29 | lint / types | PR #2 (commit `3c8c637`) used `--no-verify` for the same reason: pre-existing `@typescript-eslint/no-explicit-any` errors in `src/lib/ai-approval.ts` (5 errors — `toScorerFormShape` signature and `scoreApplication` uploads param), `src/lib/ai-decision-log.ts` (10 errors in input-snapshot building), plus a small number of `any`s in the new `scripts/test-ocr-prompts.ts` that follow the same `Record<string, any>` pattern the existing code uses for extracted-blob shapes. Same auto-resolution path as the `document-extraction.ts` row above. Durable fix: switch to `Record<string, unknown>` with narrowing where the values are read. | commit `3c8c637`; `.husky/pre-commit`; rows above | (resolved by 2026-04-26 row above; otherwise dedicated PR) |
| 2026-04-29 | ocr / prompt | Claude Vision exceeded the 100-character cap on `extraction_notes` by 9 chars (109 chars observed) on one of the 4 PR #2 verification certs (real production cert). The PR #2 scorer truncates defensively (`slice(0, 100)`) so no production impact, but the prompt is not being honored strictly. **Fix:** tighten `EXTRACTION_RULES` in `src/lib/document-extraction.ts:65` — change "max 100 characters" to "STRICTLY max 100 characters; if the note would run longer, truncate at 100 yourself before responding". Trivial one-liner PR. | T7 verification of PR #2 (commit `3c8c637`); `EXTRACTION_RULES` constant in `document-extraction.ts` | not urgent |
| 2026-04-29 | testing | `scripts/test-ocr-prompts.ts` `validateValidDoc()` asserts `degree_raw_text` presence for both `pg_degree_certificate` and `mbbs_degree_certificate`, but the MBBS prompt schema in `document-extraction.ts:175-198` does not request `degree_raw_text` (only the PG prompt does). Causes a spurious hard-fail in `--score` mode against MBBS certs. **Fix:** drop `mbbs_degree_certificate` from the `if (docType === ...)` branch at `scripts/test-ocr-prompts.ts:221`. Trivial one-liner. No production impact (test-only script). | commit `3c8c637`; `scripts/test-ocr-prompts.ts:221` | not urgent |

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

## Phase 1 OTP investigation follow-ups (2026-04-30)

Out of the 2026-04-30 OTP-cohort diagnostic. Confirmed that the "26 of 27 stuck at OTP" framing in the 2026-04-26 cleanup-drafts pause (`9711882`) was a misread — most of those drafts had verified server-side, but the `step_data.email_verified` sync was lost. That sync bug was fixed in `58f2095` (2026-04-28). Items below are the residual cleanup.

- **Backfill 28 pre-`58f2095` drafts where `otp_codes.verified=true` but `step_data.email_verified=null`.** Optional, low priority — these are abandoned anyway. The 04-28 fix only affects new verifications; pre-fix drafts won't auto-heal unless the user re-enters the verify flow. Cosmetic data hygiene.
- **Add max-reminder cap to `src/lib/bulk-draft-reminders.ts`.** Currently the cron re-eligibilises any draft 48h after the last reminder with no upper bound — a perpetually idle draft receives reminders every ~48h forever. Cap at e.g. 3 reminders, then stamp `reminder_count` (needs a schema column add on `draft_applications`). Minor schema migration + lib change.
- **Resolve `cleanup-drafts` cron status.** Currently quarantined with `CRON_PAUSED=true` literal in the route handler and removed from `vercel.json crons` (commit `9711882`, 2026-04-26). 3 of the 4 flagged Issues are addressed in code (`3961e4c`, `ce372b7`); only Issue #1 (schedule choice — hourly→daily quiet hour) is open. Needs a decision: revive with the safer behavior (and a daily schedule), delete the route entirely, or document permanently-parked status with a kill comment that supersedes the temporary `CRON_PAUSED` flag.
- **Investigate the genuinely unverified OTP cohort.** 10 of 38 OTP-only drafts have `otp_codes.verified=false` despite an OTP being sent. Cannot distinguish "Resend delivery failed" from "user abandoned" from DB alone. Needs Resend dashboard access — pull `delivered`/`bounced`/`complained` counts for `subject:"Your AMASI Verification Code"` over the last 7 days. If a non-trivial bounce rate exists, that drives a separate fix (sender reputation, SPF/DKIM, etc.); if not, it's normal abandonment.

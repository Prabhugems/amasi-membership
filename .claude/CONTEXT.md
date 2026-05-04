# Project context for Claude Code

This file is auto-imported via `AGENTS.md`. Keep it short and curated.

If you're spending more than 30 seconds reading this, it's too long — trim it.

---

## Fragile areas (read before editing)

These areas have produced 3+ recurring bugs. Edit with extra care; prefer structural fixes over tactical patches.

- **`src/app/apply/page.tsx`** (2,985 LOC). 24 fix commits in the last 4 months. Mixes phase orchestration, OCR, payment, OTP, draft sync. The `setPhase` transitions silently bounce on invalid state — see AGENTS.md "crash loudly, not redirect silently". A future refactor extracts the phase machine into `useReducer`. Until then: any new branch should `console.error + Sentry.captureException` on impossible states, never silently redirect.
- **`src/middleware.ts`** (`PUBLIC_API_ROUTES` allowlist). 13 fix commits — every new public endpoint ships 401-blocked until someone adds a string here. Long-term fix: opt-in `withAdminAuth(handler)` wrappers and drop the allowlist. Until then: when adding a new route under `/api/`, immediately decide and add to the allowlist if public.
- **Application → member field copy.** Three handlers (`api/applications/{submit,approve}/route.ts`, `lib/auto-approval.ts`) each construct the member row independently. Adding a column to one path does NOT propagate. Bug pattern: doc URLs / profile photo / new fields silently dropped on approval. Long-term fix: `lib/build-member-row.ts`. Until then: when adding a member column, edit all three callers in the same commit.
- **Razorpay payment flow.** No `payment_intents` ledger today; idempotency is checked ad-hoc. The `auto-approve` branch in `webhooks/razorpay/route.ts` is **not idempotent** against partial failure — Razorpay retries on non-2xx. Don't add side-effects to that branch without an idempotency guard.
- **Schema drift via swallowed inserts.** `try { supabase.insert(...) } catch (e) { console.error(e) }` is widespread. Failed writes do NOT surface. The `membership_audit_log` rename in 2026-04 silently broke 11 callers for an unknown duration. Prefer `.throwOnError()` or surface to Sentry; never swallow audit-write failures.
- **Next.js 16 client-router hooks.** `useSearchParams` / `usePathname` etc. without `<Suspense>` cause static prerender to fail at build time only. Has already cost ~3h of silent broken deploys (`7036f2f`). The CI `build` job (`.github/workflows/test.yml`) catches this — do not bypass it.
- **CORS for `/api/*`.** Originally pinned to one origin in `next.config.ts`, which silently blocked every `*.amasi.org` subdomain other than membership for browser-side fetches (server returned 200, browser dropped the body, no Sentry signal). As of 2026-04-30 (commit pending), CORS lives in `src/middleware.ts` via `isAllowedCorsOrigin()` from `src/lib/cors.ts` — reflects matching origins, sets `Vary: Origin`, fires Sentry on unrecognized origins. Do not move CORS back into `next.config.ts` static headers; partner integrations from new `*.amasi.org` apps depend on dynamic reflection. Extra non-amasi origins go in `CORS_ALLOWED_ORIGINS` (comma-separated env var), not in code.

## Architectural decisions

- **Auth model:** opt-out allowlist in `middleware.ts`. Admin cookie required for `/api/*` unless route is in `PUBLIC_API_ROUTES`. Member sessions checked in handlers via `getMemberSession()`. (Slated for inversion — see Fragile areas.)
- **Storage:** Bucket `uploads` is owned by this app. `form-uploads`, `event-assets`, `downloads` belong to the AMASICON event apps that share the Supabase project (`jmdwxymbgxwdsmcwbahp`) — do not modify. As of `f4cd574`, `uploads` has additive RLS policies (service-role-only ALL + authenticated INSERT). The bucket is still `public=true`; flipping to private is Phase B and requires switching `ocr/`, `applications/resubmit/`, `members/upload/` routes to store paths instead of public URLs.
- **Supabase client:** ALL server reads/writes go through `createAdminClient()` from `src/lib/supabase.ts` (service role, bypasses RLS). The only browser-side Supabase use is `src/hooks/use-realtime-count.ts` (anon key). Do not introduce a service-role client into any `'use client'` file.
- **Razorpay split:** Processing fee (₹100, ILM exempt) is split to Events360 via Razorpay Route. The transfer is included **at order creation** (`payments/create-order/route.ts:120`), with a fallback to per-payment transfer in `payments/verify/route.ts:71`. Both are server-built — never trust client-supplied transfer config.
- **Document handling:** Canonical doc keys live in `src/lib/document-keys.ts`. Always normalise via `normalizeDocumentKey()` — alias drift (e.g. `pg_certificate` vs `pg_degree_certificate`) has caused real bugs. `validateRequiredDocuments()` enforces every required doc has `status === "extracted"` AND a non-empty `fileUrl` — do not bypass either check.
- **Member fees:** `MEMBERSHIP_FEES` in `payments/create-order/route.ts` is the server-side source of truth. The client supplies the amount; the server validates against this table and rejects mismatches. If you add a membership tier, add it here first.
- **Amasi number assignment.** Default path is the `next_amasi_number` Postgres sequence (atomic, monotonic). Both approval handlers (`api/applications/approve/route.ts` + `lib/auto-approval.ts`) honor `membership_applications.assigned_amasi_number` when set on a not-yet-approved row — that number is used and the RPC is skipped, so the sequence head is untouched. This is the per-row override used to fill historical gaps in the sequence (e.g. legacy-import 2026-05-04 placed apps onto 18260, 18261, 18278–18281 — burned by Razorpay webhook retries; see auto-approval.ts comment). Null on every normal application; never gate-promote this to a handler-wide rule.
- **OCR:** Document extraction goes through `src/lib/document-extraction.ts` (Claude Sonnet Vision, with OCR.space fallback). This module was a deliberate de-dup; do not re-implement extraction inline in routes.
- **Audit logs:** Use `src/lib/audit-log.ts`. Writing directly to `membership_audit_log` from a route is a code smell — the schema has drifted twice in 2026.

## Recently fixed bugs (rolling — last 30 days, newest first)

Don't re-introduce these. If you're touching a listed area, check the commit before editing.

| Date | Commit | What broke | What fixed it |
|---|---|---|---|
| 2026-05-04 | `5c93287` / `31fbd07` | 8 paid+unapproved applications stranded in the legacy AMASI app post-cutover; 6 sequence numbers (18260, 18261, 18278–18281) sat as gaps from Razorpay webhook retries (see `auto-approval.ts:118` comment). Sequence kept advancing while no member ever landed on those numbers. | Imported the 8 as `pending_review` via `scripts/import-legacy-pending-2026-05-04.mjs` (4 of original 12 were already members → skipped). Pre-assigned the 6 gap numbers to the 6 oldest imports via `scripts/preassign-gap-numbers-2026-05-04.mjs`; the 2 newest got fresh sequence numbers (18302, 18303). Both approval paths now honor `assigned_amasi_number` so a pre-set number replaces the RPC. **Pattern: gap-fill via per-row pre-assignment, not handler-wide rules — keeps blast radius scoped to the imported rows; no other approval is affected.** |
| 2026-05-03 | `247444d` | `24547fc`'s `existingMember` exception in `/api/otp/send` re-opened the `8855294` zombie-draft gate — every member-login OTP (and profile/ticket/resubmit OTPs for members) silently spawned a null-type draft. 16 post-fix + 8 pre-`8855294` orphans + 1 test record at session start. | Wrapped draft create/update in `if (membershipType)` — only the apply page sends it, so login flows now skip drafts entirely. Same-session cleanup soft-deleted the 25 (status='expired' + audit log); incomplete pile 63 → 39. **Pattern: a fix can re-open a recently-closed bug elsewhere — re-check every gate it bypasses.** |
| 2026-04-30 | `d79cc38` | `/api/v1/members/{amasi_number}` only accepted numeric AMASI number; eventz360's `/getMemberInfo/<input>` forwards email/phone/number indiscriminately, so email lookups returned 400 "Invalid AMASI number" and phone lookups returned 404. Same FMAS LM 18263 report as the CORS row above; CORS was a real but secondary issue. | Route now accepts email (`@`), 10-digit phone, or AMASI number. Path folder stays `[amasi_number]` for URL backwards compatibility. **Pattern: when a partner forwards arbitrary user input to a single endpoint, the endpoint must triage by shape, not require partners to.** |
| 2026-04-30 | `d67f2ff` | `next.config.ts` pinned `Access-Control-Allow-Origin` to one value — every `*.amasi.org` subdomain other than membership (eventz360, future event apps) was silently CORS-blocked from `/api/members/search` and other public endpoints. Server returned 200, browser dropped body, no Sentry signal. Surfaced alongside the v1 lookup bug above; structurally separate. | CORS moved into `src/middleware.ts` with allowlist via `src/lib/cors.ts` (URL-based `*.amasi.org` match + `CORS_ALLOWED_ORIGINS` env override). Sentry now captures unrecognized origins on `/api/*`. **Pattern: server-side success + browser-side rejection is invisible without explicit observability.** |
| 2026-04-28 | `58f2095` | Post-OTP draft sync race: client `saveDraftToServer(2, {email_verified: true})` raced the Set-Cookie commit; ~27 of 51 drafts in last 30d had `otp_codes.verified=true` but step_data showed only `{otp_sent, otp_sent_at}`. Drafts looked "OTP-stuck" but had actually verified | Server-side sync in `/api/otp/verify` writes `step_data.email_verified` directly. Pre-fix back-catalog cleaned via one-shot `9dbe977` — see "Phase 1 OTP backfill" section below. **Pattern: don't depend on fire-and-forget client round-trips for critical state.** |
| 2026-04-26 | `c6aa4c9` | `apply/page.tsx` "Request Admin Review" button let users mark broken/invalid docs as `status='uploaded'` with `fileUrl=null` — produced 6 paid+broken applications | Removed the escape hatch; replaced with retry-with-clearer-photo + contact support |
| 2026-04-26 | `f4cd574` | `uploads` storage bucket public-read + signed-URL fallback leaked public URLs even on signed-URL failure | Added storage RLS (additive); removed dead public-URL fallbacks in `signed-url/route.ts` and `tickets/upload/route.ts` |
| 2026-04-25 | `dcf98a8` | `/api/credential` 401'd for public callers because middleware didn't whitelist | Added to `PUBLIC_API_ROUTES`. **Pattern: opt-out allowlist — see Fragile areas.** |
| 2026-04-25 | `24547fc` | Legacy members (in `members` but no `membership_applications`) couldn't log in via OTP | Added legacy-member fallback in OTP verify |
| 2026-04-25 | `951febb` | `/admin/fmas` capped at 1000 rows because Supabase default LIMIT not overridden | Pagination added |
| 2026-04-25 | `3227219` / `294284e` | `members/search` referenced columns that don't exist; "Know Your Membership" returned empty for every user | Use real column names in `PUBLIC_SELECT`. **Pattern: schema drift — see Fragile areas.** |
| 2026-04-24 | `7b76013` | `membership_audit_log` rename silently broke 11 callers; campaign stats stuck at 0 | Updated callers; this is the canonical "schema drift via swallowed insert" incident |
| 2026-04-24 | `8a6e8a7` | Resubmit path passed snake_case DB row to camelCase scorer; every score collapsed to ~5% | Normalize before scoring; auto-rescore for affected rows |
| 2026-04-23 | `8855294` | 95% of draft applicants trapped at step-2 OTP loop; `setPhase(selectedType ? "upload" : "landing")` silently bounced null-type users | Validate `selectedType !== null` before transition. **Pattern: silent fallback — see Fragile areas.** |
| 2026-04-23 | `467c050` | Zombie null-type drafts couldn't be backfilled on resume — stale closure on `emailVerified` in `saveDraftToServer` | Use refs for async closure state |
| 2026-04-23 | `7036f2f` | `useSearchParams()` without Suspense in `IncompletePage` silently failed 4 deploys for ~3h | Wrapped in `<Suspense>`. **Pattern: client-router hooks — CI build job now catches.** |
| 2026-04-23 | `cc8012c` | Document URLs (MCI/PG/ASI) never copied from application to member on approval; members showed all docs as "Missing" | Copy URLs in approve handler. **Pattern: app→member copy — see Fragile areas.** |
| 2026-04-23 | `5169bc3` | Profile photos never uploaded to storage post-face-detection; only stored as `File` in React state | Added storage upload step |
| 2026-04-23 | `6652c36` | Submission allowed with missing documents | 3-layer validation gate added |
| 2026-04-22 | `4e3b98d` | OCR extraction logic duplicated and drifted between `/api/ocr` and `/api/applications/resubmit`; photo doc-type triggered scoring | Centralized in `lib/document-extraction.ts`; photo excluded from scoring |
| 2026-04-22 | `93b87a4` | `/api/applications/approve` 500'd — missing `randomUUID` import | Imported from `node:crypto`; added Sentry |

(Older fixes summarised in `AUDIT-2026-04.md` §2.)

## Phase 1 OTP backfill (2026-04-30)

One-shot cleanup of 21 abandoned drafts that pre-dated the `58f2095` live fix. **Cohort flow:** 38 OTP-only drafts surveyed → 28 verified server-side (in `otp_codes`) → 22 frozen cohort (1 outlier excluded for +456s OTP-to-draft offset) → 21 backfilled (1 healed organically before the run). Implementation in `scripts/backfill-email-verified-2026-04-30.ts`, shipped in `9dbe977`.

- **Snapshot table:** `public.backfill_email_verified_2026_04_30_snapshot` (22 rows). Rollback path. **Scheduled DROP at 2026-05-30 04:30 UTC** via remote routine `trig_01PnQVSLF8N2jsDVPSDKNZVg`.
- **Fix re-verify:** remote routine `trig_012XGzr2hT5DsTjH1nTShv9D` fires 2026-05-07 04:30 UTC to confirm `58f2095` is still working for fresh post-fix drafts.
- **Backfill artifacts:** affected drafts carry `step_data.email_verified_backfilled = true` + `step_data.email_verified_backfilled_at = <ISO>`. They deliberately do NOT carry `step_data.email_verified_at` — its absence on a row that has `email_verified=true` is the backfill signal.
- **Open follow-ups:** four entries in `BACKLOG.md` § "Phase 1 OTP investigation follow-ups (2026-04-30)" — max-reminder cap on `bulk-draft-reminders.ts`, `cleanup-drafts` cron status decision, unverified-OTP cohort investigation, optional further pre-04-28 draft cleanup.

## Audit reference

The 2026-04-26 health audit is at `AUDIT-2026-04.md` (424 lines). Score: 5.5/10. Top 3 structural fixes outstanding: opt-in auth wrappers, `apply/page.tsx` state machine extraction, `payment_intents` ledger.

## Test coverage

The `__tests__/critical-paths.test.ts` file holds the canonical regression tests for the 5 highest-value flows. If a fix here doesn't add a test, add a TODO comment explaining why and link the relevant CHANGELOG entry.

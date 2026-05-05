# AMASI Membership Portal

Membership and credentialing system for the **Association of Minimal Access Surgeons of India (AMASI)** — handles new applications, document verification, payment, member login, support tickets, and partner-facing APIs for AMASICON event apps.

## What this system does

The portal is the single front door for AMASI membership. A surgeon visits `/apply`, uploads their medical registration and degree certificates, the system extracts details from the documents using AI vision, the applicant verifies their email and phone via OTP, pays the membership fee through Razorpay, and (depending on tier and document quality) is either auto-approved or queued for an admin to review. Once approved they receive an AMASI number, a digital membership card (with Apple/Google Wallet pass), and ongoing access to a member-only profile, a public verification link, and a support-ticket system.

Behind the application flow, the same codebase runs the admin console — review queues, member directory, FMAS skill-credential tracking, ticketing with SLA tracking, email campaigns, and the partner API consumed by AMASI's event apps (AMASICON) for member lookup at registration.

## Who uses it

- **Applicants and members** — surgeons applying for or holding AMASI membership. They use `/apply`, `/login` (OTP), `/profile`, `/card`, `/tickets`, and the public `/verify/<token>` credential check.
- **AMASI admins / EC members and staff** — review applications, manage members, run email campaigns, handle support tickets, oversee FMAS skill credentials. Cookie-based admin auth on `/admin/*` and most `/api/*`.
- **External partners** — AMASICON event apps (eventz360 and other `*.amasi.org` subdomains) consume `/api/v1/members/<email|phone|amasi_number>` and `/api/members/search` for member lookup. Browser CORS is reflected dynamically against an allowlist; server-to-server callers use a Bearer API key.

## Tech stack

- **Next.js 16.2.1** (App Router, Server Actions, Node runtime via Fluid Compute)
- **React 19** + TypeScript
- **Tailwind CSS v4** + Radix UI primitives + shadcn-style components
- **Supabase** (Postgres + Storage + auth-by-RLS where applicable). Schema types generated via `supabase gen types`.
- **Sentry** for error tracking and source maps
- **Razorpay** for payments, including Razorpay Route split for the processing fee
- **Resend** for transactional email
- **MSG91** for SMS OTP
- **Gallabox** for WhatsApp messaging
- **Anthropic Claude (Vision)** for OCR document extraction, with **OCR.space** as fallback
- **Upstash Redis** for rate limiting (also exposed under legacy `KV_REST_API_*` aliases)
- **Apple Wallet** + **Google Wallet** passes for the digital membership card
- **Zoho Campaigns** for member email-list sync
- **Vercel Analytics** + **Speed Insights**
- **Vitest** for unit tests, **Playwright** for end-to-end tests
- **Hosting:** Vercel (Fluid Compute), production at `membership.amasi.org`

Node runtime: `.nvmrc` and `package.json` pin Node 20.x for local development.

## External services this app connects to

| Service | Purpose |
|---|---|
| Supabase | Primary database, file storage (`uploads` bucket owned by this app) |
| Razorpay | Membership-fee payments + Route split to a partner account for the processing fee |
| Resend | Outbound email (OTP, receipts, approval/rejection, ticket replies) |
| MSG91 | SMS OTP for phone verification |
| Gallabox | WhatsApp notifications |
| Anthropic API (Claude Vision) | OCR / document field extraction |
| OCR.space | Fallback OCR provider when Claude Vision fails |
| Upstash Redis | Rate limiting and short-lived KV |
| Apple Wallet / Google Wallet | Digital membership card pass |
| Zoho Campaigns | Sync members into mailing lists |
| Sentry | Error tracking and performance |
| Airtable | Referenced by historical seed scripts; verify before relying on them |

## Local development setup

Prerequisites: Node 20.x, npm, a `.env.local` populated with the variables below, and access to the Supabase project (or your own dev project).

```bash
git clone https://github.com/Prabhugems/amasi-membership.git
cd amasi-membership
npm install
cp .env.example .env.local   # then fill in real values — never commit .env.local
npm run dev                  # http://localhost:3000
```

Other scripts:

```bash
npm run build       # production build (CI runs this on every push — do not bypass)
npm run lint        # eslint
npm run test        # vitest unit tests (vitest run)
npm run test:e2e    # playwright
npm run gen:types   # regenerate src/types/database.types.ts from Supabase schema
```

There is no separate backend service — API routes live under `src/app/api/*` and run on Vercel Functions.

## Required environment variables

All names below are referenced from the codebase. **Never commit real values.** See `.env.example` for the canonical list.

**Supabase**
- `NEXT_PUBLIC_SUPABASE_URL` — project URL (browser-safe)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon key (browser-safe)
- `SUPABASE_SERVICE_ROLE_KEY` — service-role key, **server-only**

**Auth / sessions**
- `JWT_SECRET` — signs admin + member JWTs and public verification links

**Admin notifications**
- `ADMIN_DEFAULT_EMAIL`, `ADMIN_DEFAULT_PASSWORD` — see internal admin onboarding docs
- `ADMIN_NOTIFICATION_EMAIL`, `ADMIN_EMAIL` — destination addresses for ticket and admin notifications

**Razorpay**
- `NEXT_PUBLIC_RAZORPAY_KEY_ID` — public key for the checkout widget
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` — server-side API credentials
- `RAZORPAY_WEBHOOK_SECRET` — verifies webhook signatures
- `EVENTS360_RAZORPAY_ACCOUNT_ID` — Razorpay-Route linked-account for the processing-fee split
- `PROCESSING_FEE_INR` — optional override (defaults to ₹100)

**Email (Resend)**
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` — e.g. `"AMASI <noreply@amasi.org>"`

**SMS / OTP (MSG91)**
- `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_TEMPLATE_ID`

**WhatsApp (Gallabox)**
- `GALLABOX_API_KEY`, `GALLABOX_API_SECRET`, `GALLABOX_CHANNEL_ID`

**AI extraction / OCR**
- `ANTHROPIC_API_KEY` — Claude Vision for document extraction
- `OCR_SPACE_API_KEY` — fallback provider

**Airtable** (scripts only)
- `AIRTABLE_PAT` — Personal Access Token used by historical seed scripts

**Zoho Campaigns**
- `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URI`, `ZOHO_DEFAULT_LIST_KEY`

**Wallet passes**
- `APPLE_WALLET_CERT`, `APPLE_WALLET_KEY`
- `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_KEY`

**Rate limiting / KV (Upstash)**
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` — legacy aliases some routes still read

**Cron**
- `CRON_SECRET` — bearer token Vercel cron sends; checked inside each cron route

**App URLs / flags**
- `NEXT_PUBLIC_APP_URL` — e.g. `https://membership.amasi.org`
- `NEXT_PUBLIC_MAINTENANCE_MODE` — `"true"` to show maintenance banner
- `CORS_ALLOWED_ORIGINS` — optional comma-separated extra origins beyond the built-in `*.amasi.org` allowlist

## Critical paths

- **Member application** (`src/app/apply/page.tsx` + `src/app/api/applications/*`) — multi-step flow: select type → upload documents → OCR extract → email+phone OTP → review → pay → submit. Drafts are saved server-side at every step so users can resume from a tokenised email link. **Note:** this file is large and historically fragile (see `.claude/CONTEXT.md` "Fragile areas"); read that section before editing.
- **Document OCR** (`src/lib/document-extraction.ts`, `/api/ocr`) — Claude Vision primary, OCR.space fallback. Centralised; do not reimplement extraction in routes.
- **Payments** (`/api/payments/create-order`, `/api/payments/verify`, `/api/webhooks/razorpay`) — Razorpay order with built-in Route split for the processing fee. Webhook handlers require care when adding side effects; see internal notes in `.claude/CONTEXT.md`.
- **Auto-approval / approval** (`src/lib/auto-approval.ts`, `/api/applications/approve`) — assigns the AMASI number via the `next_amasi_number` Postgres sequence, or honours a pre-assigned number on the application row (used to fill historical sequence gaps).
- **Member login** (`/login`, `/api/otp/*`) — OTP-based, no passwords. Includes a legacy-member fallback for accounts that exist in `members` but never had a `membership_applications` row.
- **Public verification** (`/verify/<token>`, `/v/<token>`, `/api/credential`) — anyone with a credential link can verify a member's status without logging in.
- **Membership card** (`/card`, `/api/card`, `/api/card/wallet`) — generates a printable PDF card and Apple/Google Wallet pass.
- **Admin console** (`/admin/*`, `/members`, `/applications`, `/tickets`, `/campaigns`, `/audit`, `/reports`) — cookie-based auth. Auth model is an opt-out allowlist in `src/middleware.ts` (`PUBLIC_API_ROUTES`); every new public endpoint must be added there.
- **Support tickets** (`/tickets`, `/api/tickets/*`) — CSAT-rated tickets with SLA breach detection (cron-driven) and per-ticket reply history.
- **Partner API** (`/api/v1/members/<email|phone|amasi_number>`, `/api/members/search`) — Bearer API-key auth for server-to-server callers; CORS reflection for `*.amasi.org` browser callers.
- **Cron jobs** (`vercel.json`) — `sla-breach` every 10 min, `weekly-digest` Mondays 04:00, `sync-members` every 6 h, `bulk-draft-reminders` daily 03:30. Each route enforces `Bearer ${CRON_SECRET}`.
- **Audit log** (`src/lib/audit-log.ts`, `membership_audit_log` table) — always go through the helper; direct inserts have caused silent breakage.

## Production deployment

- **URL:** https://membership.amasi.org
- **Host:** Vercel (Fluid Compute, Node runtime). Project is linked locally — see `.vercel/`.
- **Deploy trigger:** push to `main` (per `vercel.json` `git.deploymentEnabled.main: true`). Preview deployments fire on every other branch.
- **Source maps + monitoring:** Sentry, with the Sentry tunnel at `/monitoring`.
- **Cron schedule** is declared in `vercel.json` and run by Vercel cron.

## Related repositories

- **[amasi-membership](https://github.com/Prabhugems/amasi-membership)** — this repository.
- **[AMASI-management](https://github.com/Prabhugems/AMASI-management)** — sibling admin/ops system that shares the same Supabase project. Schema and many tables overlap; coordinate any breaking schema change across both repos.
- **AMASICON event apps** (`*.amasi.org`, e.g. eventz360) — maintained by external event partners (e.g. eventz360). They consume the partner API exposed here. Buckets `form-uploads`, `event-assets`, and `downloads` in the shared Supabase project belong to those apps; this app only owns `uploads`.

## Maintenance notes

- **Read `AGENTS.md` and `.claude/CONTEXT.md` before non-trivial changes.** They list fragile areas and recent bug-fix history.
- **Build before pushing if you touched a client-router hook** (`useSearchParams`, `usePathname`, `useRouter`) — `npx tsc` and `eslint` do not catch missing `<Suspense>` boundaries; only `next build` does. CI also enforces this; do not bypass.
- New public API routes must be added to `PUBLIC_API_ROUTES` in `src/middleware.ts`. Decide and add this in the same commit that introduces the new route.
- Application-to-member field mapping is duplicated in several locations. See `.claude/CONTEXT.md` for the canonical list before adding new member columns.
- **Storage:** this app owns only the `uploads` bucket. The other buckets in the shared Supabase project belong to the AMASICON apps — don't modify them.
- **Audit-log inserts** must go through `src/lib/audit-log.ts`. Don't swallow insert errors — surface to Sentry or use `.throwOnError()`.
- **CORS** for `/api/*` is owned by `src/middleware.ts` (dynamic origin reflection via `src/lib/cors.ts`). Do not move it back into `next.config.ts` static headers.
- **Schema types** (`src/types/database.types.ts`) are generated from the live Supabase schema by `npm run gen:types`. Run after any DB migration.
- **Test coverage:** `__tests__/critical-paths.test.ts` holds regression tests for the highest-value flows. New fixes in those areas should add a test or a TODO with a CHANGELOG link.
- **Bug-fix log:** every fix gets an entry in `CHANGELOG.md` and a row in `.claude/CONTEXT.md` "Recently fixed bugs". Future maintainers rely on this — don't skip it.

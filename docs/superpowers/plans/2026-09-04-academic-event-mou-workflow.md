# Academic Event Application & MOU Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 11-link WordPress "Application Forms & MOU's" page with a native amasi-membership module: a 9-type public application form (member lookup + OTP acknowledgment), single-approver magic-link review by the Hon. Secretary, non-blocking FYI remarks, server-generated MOU PDF, and direct event creation in the shared `events` table.

**Architecture:** One shared Postgres table (`academic_event_applications`) instead of 9, since the 9 event types share ~90% of fields — type-specific field visibility is a frontend config map, not per-type tables/components. Magic-link tokens (not sessions) gate both the Secretary's decision and notified parties' view/remark access — nobody outside amasi-membership's existing admin needs to log in. All email via Resend, WhatsApp via the existing GallaBox client. RLS enabled with no policies on every new table (default-deny; all access via `createAdminClient()` service-role client, matching this repo's universal convention).

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Storage), Resend, existing GallaBox client (`src/lib/whatsapp.ts`), `@react-pdf/renderer` for server-side MOU PDF generation (new dependency — jsPDF/html2canvas, used elsewhere in this repo for the member certificate, is browser-only and can't run in an API route).

**Spec:** `docs/superpowers/specs/2026-09-04-academic-event-mou-workflow-design.md`

## Global Constraints

- No schema migration is ever applied via Supabase MCP `execute_sql` in this repo — migrations are SQL files the user runs manually. This plan's Task 1 produces such a file; no task executes it.
- Every new public API route must be added to `PUBLIC_API_ROUTES` in `src/middleware.ts` or it 401s (this repo's #1 recurring bug per `.claude/CONTEXT.md` Fragile Areas — 13 prior fix commits).
- Every new admin-facing sidebar link must be null-gated with `useAdminRole()` per `AGENTS.md` "Admin UI gating."
- Any new client component using `useSearchParams`/`usePathname`/`useRouter` must be wrapped in `<Suspense>`, and `npx next build` must be run locally before considering that task done (`AGENTS.md` "Local build after client-router hook changes" — this has silently broken deploys before).
- UI follows `AGENTS.md` §2-3: shadcn primitives from `src/components/ui/`, lucide-react icons, CSS variables not hardcoded hex, solid `bg-card` + 1px `border-border` (no gradients).
- OTP codes are stored hashed via `hashOtp`/`otpMatches` from `src/lib/otp-hash.ts` — never store or log a raw code.
- Every admin write action logs via `logAdminAction()` from `src/lib/audit-log.ts` (table: `admin_audit_log`).

---

## File Structure

```
sql/039_academic_event_applications.sql       # new (overwrites existing draft)

src/lib/mou/
  types.ts                                     # ApplicationType, ApplicationStatus, Application row type
  event-type-config.ts                         # static field-visibility map per type (9 entries)
  supabase-helpers.ts                          # DB read/write helpers used by API routes
  otp.ts                                       # sendMouOtp / verifyMouOtp (reuses otp_codes table + otp-hash.ts)
  approval-token.ts                            # generate/hash/verify magic-link tokens
  mou-pdf.tsx                                  # generateMouPdf(application, type) -> Buffer, via @react-pdf/renderer
  notify.ts                                    # sendApplicantConfirmation, sendSecretaryApprovalRequest,
                                                #   sendFyiNotification, sendOutcomeEmail, sendWhatsAppNudge

src/app/api/mou/
  otp/send/route.ts                            # POST, public
  otp/verify/route.ts                          # POST, public
  member-lookup/route.ts                       # GET ?q=, public
  applications/route.ts                        # POST (create), public
  applications/[id]/route.ts                   # GET (status, by id — id is the capability token), public
  applications/[id]/remarks/route.ts           # POST, token-gated (query ?token=)
  review/[token]/route.ts                      # GET (summary for the review page), public but token-gated
  review/[token]/decide/route.ts               # POST { action, notes? }, token-gated

src/app/api/admin/mou-applications/
  route.ts                                     # GET list, admin-gated
  [id]/route.ts                                # GET detail, admin-gated

src/app/mou/
  page.tsx                                     # landing: 9 type cards + 5 static doc links
  [type]/page.tsx                              # application form (client component)
  status/[id]/page.tsx                         # applicant status view
  review/[token]/page.tsx                      # Secretary/notify-party review page (client component)

src/app/admin/mou-applications/
  page.tsx                                     # admin record/audit view

src/components/mou/
  application-form.tsx                         # shared form, reads event-type-config.ts
  status-badge.tsx                              # small status pill component

src/components/layout/sidebar.tsx               # modify: add 2 nav entries
src/middleware.ts                                # modify: add new public routes to PUBLIC_API_ROUTES
```

---

### Task 1: Migration file

**Files:**
- Create: `sql/039_academic_event_applications.sql` (overwrite the existing draft from this session)

**Interfaces:**
- Produces: table/column names every later task's Supabase queries depend on exactly as written below.

- [ ] **Step 1: Write the migration file**

```sql
-- 039_academic_event_applications.sql
-- Native replacement for the 7 static docs + 4 Fillout forms on
-- https://amasi.org/application-forms-mous-for-academic-events/
-- See docs/superpowers/specs/2026-09-04-academic-event-mou-workflow-design.md
--
-- Run this manually in the Supabase SQL editor — this repo does not apply
-- schema migrations via MCP execute_sql (DML only).

create table if not exists public.academic_event_types (
  id                text primary key,
  label             text not null,
  owning_entity     text not null default 'amasi' check (owning_entity in ('amasi', 'college_of_amasi')),
  requires_zone     boolean not null default false,
  approver_role     text not null default 'hon_secretary',
  notify_roles      text[] not null default array['president']::text[],
  mou_template_key  text not null,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create table if not exists public.academic_event_role_assignments (
  id           uuid primary key default gen_random_uuid(),
  role         text not null,
  name         text not null,
  email        text not null,
  phone        text,
  active_from  date not null,
  active_to    date,
  created_at   timestamptz not null default now()
);

create index if not exists academic_event_role_assignments_role_idx
  on public.academic_event_role_assignments (role, active_from desc);

create table if not exists public.academic_event_applications (
  id                          uuid primary key default gen_random_uuid(),
  application_type_id         text not null references public.academic_event_types(id),
  status                      text not null default 'submitted'
                               check (status in ('submitted', 'under_review', 'changes_requested', 'approved', 'rejected')),

  applicant_amasi_number      text,
  applicant_member_id         uuid,
  organizer_name              text not null,
  email                       text not null,
  phone_number                text not null,
  otp_verified_at             timestamptz,

  primary_institution         text not null,
  event_name                  text,
  expected_participants       text,
  live_surgery_demo           boolean,

  preferred_date_1            date not null,
  preferred_date_2            date,
  finalized_date               date,

  venue_type                  text,
  venue_name                  text,
  venue_address                text,
  venue_city                   text,
  venue_state                   text,
  venue_zip                     text,
  venue_country                  text default 'India',
  zone                          text check (zone is null or zone in ('North', 'South', 'East', 'West', 'Central')),

  auditorium_hall_a            boolean not null default false,
  auditorium_hall_b            boolean not null default false,
  av_equipment                  boolean not null default false,
  endotrainers                   boolean not null default false,
  high_speed_internet           boolean not null default false,

  agree_terms                   boolean not null default false,
  certify_accurate               boolean not null default false,
  authority_confirm              boolean not null default false,

  committee_member_photo_url     text,
  institution_photo_url           text,

  mou_generated_url                text,
  mou_version                        integer not null default 0,
  created_event_id                    uuid,

  reviewed_by                          text,
  reviewed_at                            timestamptz,
  rejection_reason                        text,
  admin_notes                              text,
  published_at                              timestamptz,

  created_at                                timestamptz not null default now(),
  updated_at                                 timestamptz not null default now()
);

create index if not exists academic_event_applications_type_status_idx
  on public.academic_event_applications (application_type_id, status);

create index if not exists academic_event_applications_created_idx
  on public.academic_event_applications (created_at desc);

create table if not exists public.academic_event_remarks (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.academic_event_applications(id) on delete cascade,
  author_name     text not null,
  author_role     text not null,
  body            text not null,
  created_at      timestamptz not null default now()
);

create index if not exists academic_event_remarks_application_idx
  on public.academic_event_remarks (application_id, created_at);

create table if not exists public.academic_event_approval_tokens (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.academic_event_applications(id) on delete cascade,
  token_hash      text not null unique,
  role            text not null,
  can_decide      boolean not null default false,
  action_taken    text check (action_taken is null or action_taken in ('approved', 'rejected', 'changes_requested')),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists academic_event_approval_tokens_application_idx
  on public.academic_event_approval_tokens (application_id);

-- RLS enabled, no policies — default-deny. All access is via the
-- service-role admin client in API routes, matching this repo's
-- universal convention (see .claude/CONTEXT.md "Architectural decisions").
alter table public.academic_event_types enable row level security;
alter table public.academic_event_role_assignments enable row level security;
alter table public.academic_event_applications enable row level security;
alter table public.academic_event_remarks enable row level security;
alter table public.academic_event_approval_tokens enable row level security;

-- Seed the 9 event types. mou_template_key matches the key used in
-- src/lib/mou/mou-pdf.tsx's TEMPLATE_COPY map (Task 6).
insert into public.academic_event_types (id, label, owning_entity, requires_zone, mou_template_key) values
  ('fmas',            'FMAS Course',                                          'college_of_amasi', false, 'fmas'),
  ('mmas',             'MMAS Course',                                          'college_of_amasi', false, 'mmas'),
  ('dmas',              'DMAS Course',                                         'college_of_amasi', false, 'dmas'),
  ('workshop',           'Workshop / CME / Conference',                        'amasi',             false, 'workshop'),
  ('rural_program',       'Rural Surgery Camp',                                 'amasi',             false, 'rural_program'),
  ('slcp',                 'Safe Laparoscopic Cholecystectomy Programme (SLCP)', 'amasi',             false, 'slcp'),
  ('nextgen',                'NextGen Organizer',                                  'amasi',             false, 'nextgen'),
  ('meet_the_master',          'Meet the Master',                                    'amasi',             false, 'meet_the_master'),
  ('zonal_event',                'Zonal Event',                                        'amasi',             true,  'zonal_event')
on conflict (id) do nothing;

-- Seed role assignments from the same people already in
-- certificate_signatories' current active row (Dr. P Senthilnathan /
-- Dr. Biswarup Bose, effective 2026-09-01) plus the 5 Zonal Vice
-- Chairpersons from the Executive Committee page rebuilt this session.
insert into public.academic_event_role_assignments (role, name, email, phone, active_from) values
  ('hon_secretary', 'Dr. Biswarup Bose', 'dr.biswarupbose@gmail.com', '+919831001112', '2026-09-01'),
  ('president', 'Dr. P Senthilnathan', 'senthilnathan94@yahoo.com', '9842210173', '2026-09-01'),
  ('zone_chair_north', 'Dr. Rajendra Mandia', 'drrmandia@yahoo.com', '+919414041728', '2026-09-01'),
  ('zone_chair_south', 'Dr. Lakshmi Kant Tipirneni', 'neelkantht@gmail.com', '+919849023623', '2026-09-01'),
  ('zone_chair_east', 'Dr. Prakash Kumar Sasmal', 'drpksasmal@gmail.com', '+919438884255', '2026-09-01'),
  ('zone_chair_west', 'Dr. Sandeep Sabnis', 'drsandeepsabnis@gmail.com', '+917598674643', '2026-09-01'),
  ('zone_chair_central', 'Dr. Rakesh Shivhare', 'drrakeshshivhare@gmail.com', '+919826680273', '2026-09-01')
on conflict do nothing;
```

- [ ] **Step 2: Tell the user this file needs to be run manually**

No `- [ ]` action here beyond noting it in the final report — this repo's convention (established this session) is the user runs SQL migrations themselves in the Supabase SQL editor. Do not call any Supabase MCP execute/apply tool on this file.

- [ ] **Step 3: Commit**

```bash
git add sql/039_academic_event_applications.sql
git commit -m "feat(mou): add academic event applications schema migration"
```

---

### Task 2: Shared types and event-type field config

**Files:**
- Create: `src/lib/mou/types.ts`
- Create: `src/lib/mou/event-type-config.ts`
- Test: `__tests__/mou-event-type-config.test.ts`

**Interfaces:**
- Produces: `ApplicationTypeId` union type, `Application` row interface, `EVENT_TYPE_CONFIG` map — every later task imports these.

- [ ] **Step 1: Write `src/lib/mou/types.ts`**

```typescript
export type ApplicationTypeId =
  | "fmas" | "mmas" | "dmas" | "workshop" | "rural_program"
  | "slcp" | "nextgen" | "meet_the_master" | "zonal_event"

export type ApplicationStatus =
  | "submitted" | "under_review" | "changes_requested" | "approved" | "rejected"

export interface AcademicEventApplication {
  id: string
  application_type_id: ApplicationTypeId
  status: ApplicationStatus
  applicant_amasi_number: string | null
  applicant_member_id: string | null
  organizer_name: string
  email: string
  phone_number: string
  otp_verified_at: string | null
  primary_institution: string
  event_name: string | null
  expected_participants: string | null
  live_surgery_demo: boolean | null
  preferred_date_1: string
  preferred_date_2: string | null
  finalized_date: string | null
  venue_type: string | null
  venue_name: string | null
  venue_address: string | null
  venue_city: string | null
  venue_state: string | null
  venue_zip: string | null
  venue_country: string | null
  zone: "North" | "South" | "East" | "West" | "Central" | null
  auditorium_hall_a: boolean
  auditorium_hall_b: boolean
  av_equipment: boolean
  endotrainers: boolean
  high_speed_internet: boolean
  agree_terms: boolean
  certify_accurate: boolean
  authority_confirm: boolean
  committee_member_photo_url: string | null
  institution_photo_url: string | null
  mou_generated_url: string | null
  mou_version: number
  created_event_id: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  rejection_reason: string | null
  admin_notes: string | null
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface NewApplicationInput {
  application_type_id: ApplicationTypeId
  organizer_name: string
  email: string
  phone_number: string
  applicant_amasi_number?: string
  applicant_member_id?: string
  primary_institution: string
  event_name?: string
  expected_participants?: string
  live_surgery_demo?: boolean
  preferred_date_1: string
  preferred_date_2?: string
  venue_type?: string
  venue_name?: string
  venue_address?: string
  venue_city?: string
  venue_state?: string
  venue_zip?: string
  venue_country?: string
  zone?: "North" | "South" | "East" | "West" | "Central"
  auditorium_hall_a?: boolean
  auditorium_hall_b?: boolean
  av_equipment?: boolean
  endotrainers?: boolean
  high_speed_internet?: boolean
  agree_terms: boolean
  certify_accurate: boolean
  authority_confirm: boolean
  committee_member_photo_url?: string
  institution_photo_url?: string
}
```

- [ ] **Step 2: Write `src/lib/mou/event-type-config.ts`**

```typescript
import type { ApplicationTypeId } from "./types"

export type MouFieldKey =
  | "amasi_membership_number" | "auditorium_facilities" | "committee_member_photo"
  | "institution_photo" | "high_speed_internet" | "expected_participants"
  | "live_surgery_demo" | "event_name" | "zone"

export interface EventTypeUiConfig {
  id: ApplicationTypeId
  label: string
  description: string
  fields: MouFieldKey[]
}

// Common to every type regardless of this list: organizer_name, email,
// phone_number, primary_institution, preferred_date_1/2, venue_*,
// agree_terms, certify_accurate, authority_confirm. Only the EXTRA
// fields per type are listed here — src/components/mou/application-form.tsx
// always renders the common set, then conditionally renders these.
export const EVENT_TYPE_CONFIG: Record<ApplicationTypeId, EventTypeUiConfig> = {
  fmas: {
    id: "fmas", label: "FMAS Course", description: "Fellowship in Minimal Access Surgery skill course",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo"],
  },
  mmas: {
    id: "mmas", label: "MMAS Course", description: "Mastery in Minimal Access Surgery skill course",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo"],
  },
  dmas: {
    id: "dmas", label: "DMAS Course", description: "Diploma in Minimal Access Surgery skill course",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo"],
  },
  slcp: {
    id: "slcp", label: "Safe Laparoscopic Cholecystectomy Programme", description: "SLCP hosting application",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo",
      "high_speed_internet", "expected_participants", "live_surgery_demo"],
  },
  workshop: {
    id: "workshop", label: "Workshop / CME / Conference", description: "AMASI workshop, CME, or conference hosting application",
    fields: ["event_name", "expected_participants", "live_surgery_demo"],
  },
  rural_program: {
    id: "rural_program", label: "Rural Surgery Camp", description: "Rural Surgery Camp hosting application",
    fields: ["amasi_membership_number", "auditorium_facilities", "committee_member_photo", "institution_photo"],
  },
  nextgen: {
    id: "nextgen", label: "NextGen Organizer", description: "AMASI NextGen: Nurturing the Future hosting application",
    fields: ["committee_member_photo"],
  },
  meet_the_master: {
    id: "meet_the_master", label: "Meet the Master", description: "A Day with a Master hosting application",
    fields: ["event_name", "expected_participants", "live_surgery_demo"],
  },
  zonal_event: {
    id: "zonal_event", label: "Zonal Event", description: "A zone-specific AMASI event",
    fields: ["event_name", "zone", "expected_participants"],
  },
}

export function getEventTypeConfig(id: string): EventTypeUiConfig | null {
  return (EVENT_TYPE_CONFIG as Record<string, EventTypeUiConfig>)[id] ?? null
}
```

- [ ] **Step 3: Write the failing test**

```typescript
// __tests__/mou-event-type-config.test.ts
import { describe, it, expect } from "vitest"
import { EVENT_TYPE_CONFIG, getEventTypeConfig } from "@/lib/mou/event-type-config"

describe("EVENT_TYPE_CONFIG", () => {
  it("has exactly the 9 in-scope event types", () => {
    const ids = Object.keys(EVENT_TYPE_CONFIG).sort()
    expect(ids).toEqual([
      "dmas", "fmas", "meet_the_master", "mmas", "nextgen",
      "rural_program", "slcp", "workshop", "zonal_event",
    ].sort())
  })

  it("only zonal_event requires the zone field", () => {
    for (const [id, config] of Object.entries(EVENT_TYPE_CONFIG)) {
      const hasZone = config.fields.includes("zone")
      expect(hasZone).toBe(id === "zonal_event")
    }
  })

  it("getEventTypeConfig returns null for an unknown type", () => {
    expect(getEventTypeConfig("not_a_real_type")).toBeNull()
  })

  it("getEventTypeConfig returns the config for a known type", () => {
    expect(getEventTypeConfig("fmas")?.label).toBe("FMAS Course")
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-event-type-config.test.ts`
Expected: FAIL — module `@/lib/mou/event-type-config` files don't exist yet (if Steps 1-2 weren't done first) or all pass immediately if they were. Do Steps 1-2 BEFORE this step so the fail-then-pass cycle is meaningful for the test file itself: temporarily rename `event-type-config.ts` to confirm the test fails without it, then restore.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-event-type-config.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/mou/types.ts src/lib/mou/event-type-config.ts __tests__/mou-event-type-config.test.ts
git commit -m "feat(mou): add shared types and per-type field config"
```

---

### Task 3: OTP helper for MOU applications

**Files:**
- Create: `src/lib/mou/otp.ts`
- Test: `__tests__/mou-otp.test.ts`

**Interfaces:**
- Consumes: `hashOtp`, `otpMatches`, `OTP_FAILURE_MESSAGE` from `src/lib/otp-hash.ts`; `createAdminClient` from `src/lib/supabase.ts`; `checkRateLimit` from `src/lib/rate-limit.ts` (signature: `checkRateLimit(key: string, limit?: number, windowMs?: number): Promise<{allowed: boolean; remaining: number; resetAt: number}>`).
- Produces: `sendMouOtp(email: string): Promise<{ok: true} | {ok: false; message: string}>`, `verifyMouOtp(email: string, code: string): Promise<{ok: true} | {ok: false; message: string}>` — used by Task 8's API routes.

This reuses the existing `otp_codes` table (columns: `email`, `code_hash`, `attempts`, `expires_at`, `verified`, `created_at` — confirmed in `src/app/api/otp/verify/route.ts`) rather than creating a new table, but through dedicated functions with none of `/api/otp/send`'s membership-application-specific logic (draft/membershipType coupling).

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/mou-otp.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const insertMock = vi.fn().mockResolvedValue({ error: null })
const singleMock = vi.fn()
const updateMock = vi.fn().mockResolvedValue({ error: null })

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "otp_codes") throw new Error(`unexpected table ${table}`)
      return {
        insert: insertMock,
        select: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => ({
                order: () => ({
                  limit: () => ({ single: singleMock }),
                }),
              }),
            }),
          }),
        }),
        update: () => ({ eq: updateMock }),
      }
    },
  }),
}))

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() }),
}))

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn().mockResolvedValue({ data: { id: "test" }, error: null }) }
  },
}))

import { sendMouOtp, verifyMouOtp } from "@/lib/mou/otp"
import { hashOtp } from "@/lib/otp-hash"

describe("sendMouOtp", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-key"
    insertMock.mockClear()
  })

  it("rejects an invalid email shape", async () => {
    const result = await sendMouOtp("not-an-email")
    expect(result.ok).toBe(false)
  })

  it("inserts a hashed OTP row for a valid email", async () => {
    const result = await sendMouOtp("organizer@example.com")
    expect(result.ok).toBe(true)
    expect(insertMock).toHaveBeenCalledTimes(1)
    const inserted = insertMock.mock.calls[0][0]
    expect(inserted.email).toBe("organizer@example.com")
    expect(inserted.code_hash).toHaveLength(64) // sha256 hex
  })
})

describe("verifyMouOtp", () => {
  it("fails when no matching OTP row exists", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "no rows" } })
    const result = await verifyMouOtp("organizer@example.com", "123456")
    expect(result.ok).toBe(false)
  })

  it("succeeds when the code matches the stored hash", async () => {
    singleMock.mockResolvedValueOnce({
      data: { id: "otp-1", code_hash: hashOtp("654321"), attempts: 0, email: "organizer@example.com" },
      error: null,
    })
    const result = await verifyMouOtp("organizer@example.com", "654321")
    expect(result.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-otp.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mou/otp'"

- [ ] **Step 3: Write `src/lib/mou/otp.ts`**

```typescript
import { randomInt } from "node:crypto"
import { Resend } from "resend"
import { createAdminClient } from "@/lib/supabase"
import { hashOtp, otpMatches, OTP_FAILURE_MESSAGE } from "@/lib/otp-hash"
import { checkRateLimit } from "@/lib/rate-limit"
import { isValidEmailShape } from "@/lib/email-typo"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

function generateOtp(): string {
  return String(randomInt(100000, 999999))
}

type OtpResult = { ok: true } | { ok: false; message: string }

export async function sendMouOtp(email: string): Promise<OtpResult> {
  if (!email || !isValidEmailShape(email)) {
    return { ok: false, message: "Valid email is required" }
  }

  const rl = await checkRateLimit(`mou-otp:${email.toLowerCase()}`, 5, 15 * 60 * 1000)
  if (!rl.allowed) {
    return { ok: false, message: "Too many attempts. Please try again later." }
  }

  const code = generateOtp()
  const supabase = createAdminClient()
  const { error } = await supabase.from("otp_codes").insert({
    email: email.toLowerCase(),
    code_hash: hashOtp(code),
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    verified: false,
    attempts: 0,
  })
  if (error) return { ok: false, message: "Could not send code. Please try again." }

  await getResend().emails.send({
    from: "AMASI <noreply@amasi.org>",
    to: email,
    subject: "Your AMASI application verification code",
    html: `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
  })

  return { ok: true }
}

export async function verifyMouOtp(email: string, code: string): Promise<OtpResult> {
  const supabase = createAdminClient()
  const { data: otpRecord, error } = await supabase
    .from("otp_codes")
    .select("id, code_hash, attempts, email")
    .eq("email", email.toLowerCase())
    .eq("verified", false)
    .gte("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .single()

  if (error || !otpRecord) return { ok: false, message: OTP_FAILURE_MESSAGE }
  if (otpRecord.attempts >= 5) return { ok: false, message: OTP_FAILURE_MESSAGE }

  await supabase.from("otp_codes").update({ attempts: otpRecord.attempts + 1 }).eq("id", otpRecord.id)

  if (!otpMatches(code, otpRecord.code_hash)) return { ok: false, message: OTP_FAILURE_MESSAGE }

  await supabase.from("otp_codes").update({ verified: true }).eq("id", otpRecord.id)
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-otp.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mou/otp.ts __tests__/mou-otp.test.ts
git commit -m "feat(mou): add OTP send/verify helpers for MOU applications"
```

---

### Task 4: Approval token helper (magic links)

**Files:**
- Create: `src/lib/mou/approval-token.ts`
- Test: `__tests__/mou-approval-token.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` from `src/lib/supabase.ts`.
- Produces: `createApprovalToken(applicationId: string, role: string, canDecide: boolean): Promise<string>` (returns the RAW token, only ever returned once — caller puts it in the email link), `verifyApprovalToken(rawToken: string): Promise<{ok: true; row: ApprovalTokenRow} | {ok: false; message: string}>`, `markTokenUsed(rawToken: string, action: "approved" | "rejected" | "changes_requested"): Promise<void>` — used by Tasks 9 and the review-page API routes.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/mou-approval-token.test.ts
import { describe, it, expect, vi } from "vitest"

const insertMock = vi.fn().mockResolvedValue({ error: null })
const singleMock = vi.fn()
const updateEqMock = vi.fn().mockResolvedValue({ error: null })

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: insertMock,
      select: () => ({ eq: () => ({ single: singleMock }) }),
      update: () => ({ eq: updateEqMock }),
    }),
  }),
}))

import { createApprovalToken, verifyApprovalToken } from "@/lib/mou/approval-token"

describe("createApprovalToken", () => {
  it("inserts a hashed token and returns the raw token to the caller", async () => {
    const raw = await createApprovalToken("app-1", "hon_secretary", true)
    expect(typeof raw).toBe("string")
    expect(raw.length).toBeGreaterThanOrEqual(32)
    const inserted = insertMock.mock.calls[0][0]
    expect(inserted.application_id).toBe("app-1")
    expect(inserted.token_hash).not.toBe(raw) // never store the raw token
  })
})

describe("verifyApprovalToken", () => {
  it("rejects an expired token", async () => {
    singleMock.mockResolvedValueOnce({
      data: { id: "t1", expires_at: new Date(Date.now() - 1000).toISOString(), used_at: null, can_decide: true },
      error: null,
    })
    const result = await verifyApprovalToken("some-raw-token")
    expect(result.ok).toBe(false)
  })

  it("rejects an already-used token", async () => {
    singleMock.mockResolvedValueOnce({
      data: { id: "t1", expires_at: new Date(Date.now() + 100000).toISOString(), used_at: new Date().toISOString(), can_decide: true },
      error: null,
    })
    const result = await verifyApprovalToken("some-raw-token")
    expect(result.ok).toBe(false)
  })

  it("accepts a valid, unused, unexpired token", async () => {
    singleMock.mockResolvedValueOnce({
      data: { id: "t1", expires_at: new Date(Date.now() + 100000).toISOString(), used_at: null, can_decide: true },
      error: null,
    })
    const result = await verifyApprovalToken("some-raw-token")
    expect(result.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-approval-token.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mou/approval-token'"

- [ ] **Step 3: Write `src/lib/mou/approval-token.ts`**

```typescript
import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase"

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

export interface ApprovalTokenRow {
  id: string
  application_id: string
  role: string
  can_decide: boolean
}

export async function createApprovalToken(
  applicationId: string,
  role: string,
  canDecide: boolean,
  expiresInDays = 30
): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex")
  const supabase = createAdminClient()
  await supabase.from("academic_event_approval_tokens").insert({
    application_id: applicationId,
    token_hash: hashToken(raw),
    role,
    can_decide: canDecide,
    expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
  })
  return raw
}

type VerifyResult = { ok: true; row: ApprovalTokenRow } | { ok: false; message: string }

export async function verifyApprovalToken(rawToken: string): Promise<VerifyResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("academic_event_approval_tokens")
    .select("id, application_id, role, can_decide, expires_at, used_at")
    .eq("token_hash", hashToken(rawToken))
    .single()

  if (error || !data) return { ok: false, message: "This link is not valid." }
  if (new Date(data.expires_at) < new Date()) return { ok: false, message: "This link has expired." }
  if (data.used_at) return { ok: false, message: "This link has already been used to make a decision." }

  return { ok: true, row: data }
}

export async function markTokenUsed(
  rawToken: string,
  action: "approved" | "rejected" | "changes_requested"
): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from("academic_event_approval_tokens")
    .update({ action_taken: action, used_at: new Date().toISOString() })
    .eq("token_hash", hashToken(rawToken))
}
```

Note: `markTokenUsed` is only called for `can_decide: true` tokens (the Secretary's). Notify-party tokens (`can_decide: false`) are re-checked for expiry/existence on every remark POST but never marked used — they stay valid for repeated viewing/commenting until they expire.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-approval-token.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mou/approval-token.ts __tests__/mou-approval-token.test.ts
git commit -m "feat(mou): add magic-link approval token helper"
```

---

### Task 5: Supabase data-access helpers

**Files:**
- Create: `src/lib/mou/supabase-helpers.ts`
- Test: `__tests__/mou-supabase-helpers.test.ts`

**Interfaces:**
- Consumes: `createAdminClient` from `src/lib/supabase.ts`; `NewApplicationInput`, `AcademicEventApplication`, `ApplicationStatus` from `src/lib/mou/types.ts`.
- Produces: `createApplication(input: NewApplicationInput): Promise<AcademicEventApplication>`, `getApplicationById(id: string): Promise<AcademicEventApplication | null>`, `updateApplicationStatus(id: string, status: ApplicationStatus, fields?: Partial<AcademicEventApplication>): Promise<void>`, `getRoleAssignment(role: string): Promise<{name: string; email: string; phone: string | null} | null>`, `listApplications(filters: {type?: string; status?: string; limit?: number; offset?: number}): Promise<{rows: AcademicEventApplication[]; total: number}>`, `createRemark(applicationId: string, authorName: string, authorRole: string, body: string): Promise<void>`, `lookupMemberByNumberOrEmail(q: string): Promise<{id: string; name: string; amasi_number: number; email: string | null; phone: string | number | null; pg_degree: string | null} | null>` — used by every API route in Tasks 8-10.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/mou-supabase-helpers.test.ts
import { describe, it, expect, vi } from "vitest"

const singleMock = vi.fn()
const insertSelectSingleMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: () => ({ select: () => ({ single: insertSelectSingleMock }) }),
      select: () => ({
        eq: () => ({ single: singleMock, limit: () => ({ maybeSingle: singleMock }) }),
        or: () => ({ limit: () => ({ maybeSingle: singleMock }) }),
      }),
      update: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    }),
  }),
}))

import { getRoleAssignment, lookupMemberByNumberOrEmail } from "@/lib/mou/supabase-helpers"

describe("getRoleAssignment", () => {
  it("returns null when no assignment row exists", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "no rows" } })
    const result = await getRoleAssignment("hon_secretary")
    expect(result).toBeNull()
  })

  it("returns the assignment when found", async () => {
    singleMock.mockResolvedValueOnce({
      data: { name: "Dr. Biswarup Bose", email: "dr.biswarupbose@gmail.com", phone: "+919831001112" },
      error: null,
    })
    const result = await getRoleAssignment("hon_secretary")
    expect(result?.name).toBe("Dr. Biswarup Bose")
  })
})

describe("lookupMemberByNumberOrEmail", () => {
  it("returns null when nothing matches", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "no rows" } })
    const result = await lookupMemberByNumberOrEmail("no-such-member@example.com")
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-supabase-helpers.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mou/supabase-helpers'"

- [ ] **Step 3: Write `src/lib/mou/supabase-helpers.ts`**

```typescript
import { createAdminClient } from "@/lib/supabase"
import type { AcademicEventApplication, ApplicationStatus, NewApplicationInput } from "./types"

export async function createApplication(input: NewApplicationInput): Promise<AcademicEventApplication> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("academic_event_applications")
    .insert({ ...input, otp_verified_at: new Date().toISOString() })
    .select()
    .single()
  if (error || !data) throw new Error(error?.message || "Failed to create application")
  return data as AcademicEventApplication
}

export async function getApplicationById(id: string): Promise<AcademicEventApplication | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from("academic_event_applications").select("*").eq("id", id).single()
  if (error || !data) return null
  return data as AcademicEventApplication
}

export async function updateApplicationStatus(
  id: string,
  status: ApplicationStatus,
  fields: Partial<AcademicEventApplication> = {}
): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from("academic_event_applications")
    .update({ status, ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
}

export async function getRoleAssignment(
  role: string
): Promise<{ name: string; email: string; phone: string | null } | null> {
  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from("academic_event_role_assignments")
    .select("name, email, phone")
    .eq("role", role)
    .lte("active_from", today)
    .or(`active_to.is.null,active_to.gte.${today}`)
    .order("active_from", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data
}

export async function listApplications(filters: {
  type?: string
  status?: string
  limit?: number
  offset?: number
}): Promise<{ rows: AcademicEventApplication[]; total: number }> {
  const supabase = createAdminClient()
  let query = supabase.from("academic_event_applications").select("*", { count: "exact" })
  if (filters.type) query = query.eq("application_type_id", filters.type)
  if (filters.status) query = query.eq("status", filters.status)
  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as AcademicEventApplication[], total: count ?? 0 }
}

export async function createRemark(
  applicationId: string,
  authorName: string,
  authorRole: string,
  body: string
): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from("academic_event_remarks").insert({
    application_id: applicationId,
    author_name: authorName,
    author_role: authorRole,
    body,
  })
}

export async function lookupMemberByNumberOrEmail(q: string): Promise<{
  id: string
  name: string
  amasi_number: number
  email: string | null
  phone: string | number | null
  pg_degree: string | null
} | null> {
  const supabase = createAdminClient()
  const isNumeric = /^\d+$/.test(q.trim())
  const query = supabase.from("members").select("id, name, amasi_number, email, phone, pg_degree")
  const { data, error } = isNumeric
    ? await query.eq("amasi_number", parseInt(q.trim(), 10)).limit(1).maybeSingle()
    : await query.eq("email", q.trim().toLowerCase()).limit(1).maybeSingle()
  if (error || !data) return null
  return data
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-supabase-helpers.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mou/supabase-helpers.ts __tests__/mou-supabase-helpers.test.ts
git commit -m "feat(mou): add Supabase data-access helpers"
```

---

### Task 6: MOU PDF generation

**Files:**
- Create: `src/lib/mou/mou-pdf.tsx`
- Modify: `package.json` (add `@react-pdf/renderer` dependency)
- Test: `__tests__/mou-pdf.test.ts`

**Interfaces:**
- Consumes: `AcademicEventApplication` from `src/lib/mou/types.ts`.
- Produces: `generateMouPdf(application: AcademicEventApplication, typeLabel: string): Promise<Buffer>` — used by Task 9's decide route.

- [ ] **Step 1: Install the dependency**

```bash
cd ~/amasi-membership && npm install @react-pdf/renderer
```

- [ ] **Step 2: Write the failing test**

```typescript
// __tests__/mou-pdf.test.ts
import { describe, it, expect } from "vitest"
import { generateMouPdf } from "@/lib/mou/mou-pdf"
import type { AcademicEventApplication } from "@/lib/mou/types"

const fakeApplication: AcademicEventApplication = {
  id: "app-1", application_type_id: "fmas", status: "approved",
  applicant_amasi_number: "12345", applicant_member_id: null,
  organizer_name: "Dr. Test Organizer", email: "test@example.com", phone_number: "9999999999",
  otp_verified_at: new Date().toISOString(), primary_institution: "Test Hospital",
  event_name: null, expected_participants: null, live_surgery_demo: null,
  preferred_date_1: "2026-12-01", preferred_date_2: null, finalized_date: "2026-12-01",
  venue_type: "Hospital", venue_name: "Test Hospital Auditorium", venue_address: "1 Test Road",
  venue_city: "Chennai", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India", zone: null,
  auditorium_hall_a: true, auditorium_hall_b: false, av_equipment: true, endotrainers: true,
  high_speed_internet: false, agree_terms: true, certify_accurate: true, authority_confirm: true,
  committee_member_photo_url: null, institution_photo_url: null,
  mou_generated_url: null, mou_version: 0, created_event_id: null,
  reviewed_by: "Dr. Biswarup Bose", reviewed_at: new Date().toISOString(),
  rejection_reason: null, admin_notes: null, published_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
}

describe("generateMouPdf", () => {
  it("produces a non-empty PDF buffer", async () => {
    const buffer = await generateMouPdf(fakeApplication, "FMAS Course")
    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-pdf.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mou/mou-pdf'"

- [ ] **Step 4: Write `src/lib/mou/mou-pdf.tsx`**

```tsx
import React from "react"
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import type { AcademicEventApplication } from "./types"

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica" },
  title: { fontSize: 16, marginBottom: 4, textAlign: "center" },
  subtitle: { fontSize: 10, marginBottom: 20, textAlign: "center", color: "#555" },
  row: { flexDirection: "row", marginBottom: 6 },
  label: { width: 180, fontWeight: 700 },
  value: { flex: 1 },
  section: { marginTop: 16, marginBottom: 8, fontSize: 12, fontWeight: 700 },
  footer: { marginTop: 40, fontSize: 9, color: "#777" },
})

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  )
}

export async function generateMouPdf(application: AcademicEventApplication, typeLabel: string): Promise<Buffer> {
  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Memorandum of Understanding</Text>
        <Text style={styles.subtitle}>{typeLabel} — Association of Minimal Access Surgeons of India</Text>

        <Text style={styles.section}>Organizer</Text>
        <Row label="Name" value={application.organizer_name} />
        <Row label="Institution" value={application.primary_institution} />
        <Row label="Email" value={application.email} />
        <Row label="Phone" value={application.phone_number} />
        {application.applicant_amasi_number && (
          <Row label="AMASI Membership No." value={application.applicant_amasi_number} />
        )}

        <Text style={styles.section}>Event</Text>
        <Row label="Finalized Date" value={application.finalized_date ?? application.preferred_date_1} />
        <Row label="Venue" value={[application.venue_name, application.venue_city, application.venue_state].filter(Boolean).join(", ")} />

        <Text style={styles.section}>Acknowledgment</Text>
        <Text>
          This application was verified by a one-time code sent to the organizer&apos;s registered contact on{" "}
          {application.otp_verified_at ? new Date(application.otp_verified_at).toLocaleString("en-IN") : "N/A"}, and
          approved by {application.reviewed_by ?? "the AMASI Hon. Secretary"} on{" "}
          {application.reviewed_at ? new Date(application.reviewed_at).toLocaleString("en-IN") : "N/A"}.
        </Text>

        <Text style={styles.footer}>
          Generated by AMASI Membership Portal — Application ID {application.id} — Version {application.mou_version + 1}
        </Text>
      </Page>
    </Document>
  )
  return renderToBuffer(doc)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-pdf.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/mou/mou-pdf.tsx __tests__/mou-pdf.test.ts
git commit -m "feat(mou): add server-side MOU PDF generation"
```

---

### Task 7: Notification helpers (email + WhatsApp)

**Files:**
- Create: `src/lib/mou/notify.ts`
- Test: `__tests__/mou-notify.test.ts`

**Interfaces:**
- Consumes: `AcademicEventApplication` from `./types`; `sendTemplate` from `src/lib/whatsapp.ts` (signature: `sendTemplate(phone: string, recipientName: string, templateName: string, bodyValues: Record<string,string>): Promise<{success: boolean; error?: string}>`).
- Produces: `sendApplicantConfirmation(application)`, `sendSecretaryApprovalRequest(application, typeLabel, secretaryEmail, magicLinkUrl)`, `sendFyiNotification(application, typeLabel, recipientEmail, recipientRole, viewLinkUrl)`, `sendOutcomeEmail(application, typeLabel, outcome: "approved"|"rejected"|"changes_requested", mouPdfBuffer?)`, `sendWhatsAppNudge(application, outcome)` — all `Promise<void>`, used by Tasks 8 and 9.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/mou-notify.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const sendMock = vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null })
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock }
  },
}))

const sendTemplateMock = vi.fn().mockResolvedValue({ success: true })
vi.mock("@/lib/whatsapp", () => ({ sendTemplate: sendTemplateMock }))

import { sendApplicantConfirmation, sendWhatsAppNudge } from "@/lib/mou/notify"
import type { AcademicEventApplication } from "@/lib/mou/types"

const app: AcademicEventApplication = {
  id: "app-1", application_type_id: "fmas", status: "submitted",
  applicant_amasi_number: null, applicant_member_id: null,
  organizer_name: "Dr. Test", email: "organizer@example.com", phone_number: "9999999999",
  otp_verified_at: new Date().toISOString(), primary_institution: "Test Hospital",
  event_name: null, expected_participants: null, live_surgery_demo: null,
  preferred_date_1: "2026-12-01", preferred_date_2: null, finalized_date: null,
  venue_type: null, venue_name: null, venue_address: null, venue_city: null,
  venue_state: null, venue_zip: null, venue_country: null, zone: null,
  auditorium_hall_a: false, auditorium_hall_b: false, av_equipment: false, endotrainers: false,
  high_speed_internet: false, agree_terms: true, certify_accurate: true, authority_confirm: true,
  committee_member_photo_url: null, institution_photo_url: null,
  mou_generated_url: null, mou_version: 0, created_event_id: null,
  reviewed_by: null, reviewed_at: null, rejection_reason: null, admin_notes: null, published_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
}

describe("sendApplicantConfirmation", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-key"
    sendMock.mockClear()
  })

  it("sends one email to the applicant", async () => {
    await sendApplicantConfirmation(app)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0].to).toBe("organizer@example.com")
  })
})

describe("sendWhatsAppNudge", () => {
  it("does not throw when GallaBox is unconfigured (sendTemplate returns success:false)", async () => {
    sendTemplateMock.mockResolvedValueOnce({ success: false, error: "WhatsApp not configured" })
    await expect(sendWhatsAppNudge(app, "approved")).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-notify.test.ts`
Expected: FAIL with "Cannot find module '@/lib/mou/notify'"

- [ ] **Step 3: Write `src/lib/mou/notify.ts`**

```typescript
import { Resend } from "resend"
import { sendTemplate } from "@/lib/whatsapp"
import type { AcademicEventApplication } from "./types"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

const FROM = "AMASI <noreply@amasi.org>"

export async function sendApplicantConfirmation(application: AcademicEventApplication): Promise<void> {
  await getResend().emails.send({
    from: FROM,
    to: application.email,
    subject: "AMASI application received",
    html: `<p>Dear ${application.organizer_name},</p>
      <p>Your application (ID ${application.id}) has been received and is under review by the AMASI Hon. Secretary.
      You'll be notified by email once a decision is made.</p>`,
  })
}

export async function sendSecretaryApprovalRequest(
  application: AcademicEventApplication,
  typeLabel: string,
  secretaryEmail: string,
  magicLinkUrl: string
): Promise<void> {
  await getResend().emails.send({
    from: FROM,
    to: secretaryEmail,
    subject: `Application for review: ${typeLabel} — ${application.organizer_name}`,
    html: `<p>A new ${typeLabel} application from ${application.organizer_name} (${application.primary_institution})
      needs your decision.</p>
      <p><a href="${magicLinkUrl}">Review and decide</a></p>`,
  })
}

export async function sendFyiNotification(
  application: AcademicEventApplication,
  typeLabel: string,
  recipientEmail: string,
  recipientRole: string,
  viewLinkUrl: string
): Promise<void> {
  await getResend().emails.send({
    from: FROM,
    to: recipientEmail,
    subject: `FYI: ${typeLabel} application from ${application.organizer_name}`,
    html: `<p>A new ${typeLabel} application from ${application.organizer_name} has been submitted and is
      awaiting the Hon. Secretary's decision. This is for your information only — no action is needed from you.</p>
      <p><a href="${viewLinkUrl}">View application and leave a remark</a></p>`,
  })
}

export async function sendOutcomeEmail(
  application: AcademicEventApplication,
  typeLabel: string,
  outcome: "approved" | "rejected" | "changes_requested",
  mouPdfBuffer?: Buffer
): Promise<void> {
  const subjectByOutcome = {
    approved: `Your ${typeLabel} application has been approved`,
    rejected: `Your ${typeLabel} application was not approved`,
    changes_requested: `Changes requested on your ${typeLabel} application`,
  }
  const bodyByOutcome = {
    approved: `<p>Congratulations — your application has been approved. The signed MOU is attached.</p>`,
    rejected: `<p>Your application was not approved.${application.rejection_reason ? ` Reason: ${application.rejection_reason}` : ""}</p>`,
    changes_requested: `<p>The Hon. Secretary has requested changes.${application.rejection_reason ? ` Details: ${application.rejection_reason}` : ""}</p>`,
  }
  await getResend().emails.send({
    from: FROM,
    to: application.email,
    subject: subjectByOutcome[outcome],
    html: `<p>Dear ${application.organizer_name},</p>${bodyByOutcome[outcome]}`,
    ...(mouPdfBuffer
      ? { attachments: [{ filename: `MOU-${application.id}.pdf`, content: mouPdfBuffer.toString("base64") }] }
      : {}),
  })
}

export async function sendWhatsAppNudge(
  application: AcademicEventApplication,
  outcome: "approved" | "rejected" | "changes_requested"
): Promise<void> {
  // sendTemplate requires a pre-approved GallaBox template. Template name
  // "mou_application_outcome" must exist in the GallaBox dashboard before
  // this fires in production — if it doesn't, sendTemplate returns
  // {success:false} rather than throwing, so this never blocks the rest
  // of the approval chain.
  await sendTemplate(String(application.phone_number), application.organizer_name, "mou_application_outcome", {
    outcome,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-notify.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mou/notify.ts __tests__/mou-notify.test.ts
git commit -m "feat(mou): add email and WhatsApp notification helpers"
```

---

### Task 8: Public API routes — OTP, member lookup, create application, status

**Files:**
- Create: `src/app/api/mou/otp/send/route.ts`
- Create: `src/app/api/mou/otp/verify/route.ts`
- Create: `src/app/api/mou/member-lookup/route.ts`
- Create: `src/app/api/mou/applications/route.ts`
- Create: `src/app/api/mou/applications/[id]/route.ts`
- Modify: `src/middleware.ts` (add 5 routes to `PUBLIC_API_ROUTES`)
- Test: `__tests__/mou-api-applications.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2, 3, 5, 7 (`sendMouOtp`, `verifyMouOtp`, `lookupMemberByNumberOrEmail`, `createApplication`, `getApplicationById`, `sendApplicantConfirmation`, `createApprovalToken`, `getRoleAssignment`, `sendSecretaryApprovalRequest`, `sendFyiNotification`, `EVENT_TYPE_CONFIG`).
- Produces: the 5 route handlers Task 11's frontend pages call directly by URL.

- [ ] **Step 1: Write `src/app/api/mou/otp/send/route.ts`**

```typescript
// @auth: public — issues a one-time code for MOU application verification.
import { NextRequest } from "next/server"
import { sendMouOtp } from "@/lib/mou/otp"

export async function POST(request: NextRequest) {
  const { email } = await request.json()
  if (!email || typeof email !== "string") {
    return Response.json({ status: false, message: "Email is required" }, { status: 400 })
  }
  const result = await sendMouOtp(email)
  if (!result.ok) return Response.json({ status: false, message: result.message }, { status: 400 })
  return Response.json({ status: true })
}
```

- [ ] **Step 2: Write `src/app/api/mou/otp/verify/route.ts`**

```typescript
// @auth: public — verifies a one-time code for MOU application submission.
import { NextRequest } from "next/server"
import { verifyMouOtp } from "@/lib/mou/otp"

export async function POST(request: NextRequest) {
  const { email, code } = await request.json()
  if (!email || !code) {
    return Response.json({ status: false, message: "Email and code are required" }, { status: 400 })
  }
  const result = await verifyMouOtp(email, code)
  if (!result.ok) return Response.json({ status: false, message: result.message }, { status: 400 })
  return Response.json({ status: true })
}
```

- [ ] **Step 3: Write `src/app/api/mou/member-lookup/route.ts`**

```typescript
// @auth: public — looks up an AMASI member by membership number or email
// to pre-fill the MOU application form. Returns only display-safe fields.
import { NextRequest } from "next/server"
import { lookupMemberByNumberOrEmail } from "@/lib/mou/supabase-helpers"

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q")
  if (!q || q.trim().length < 3) {
    return Response.json({ status: false, message: "Enter a membership number or email" }, { status: 400 })
  }
  const member = await lookupMemberByNumberOrEmail(q)
  if (!member) return Response.json({ status: true, member: null })
  return Response.json({
    status: true,
    member: {
      id: member.id,
      name: member.name,
      amasi_number: member.amasi_number,
      email: member.email,
      phone: member.phone,
      pg_degree: member.pg_degree,
    },
  })
}
```

- [ ] **Step 4: Write the failing test for application creation**

```typescript
// __tests__/mou-api-applications.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/mou/otp", () => ({ verifyMouOtp: vi.fn() }))
vi.mock("@/lib/mou/supabase-helpers", () => ({
  createApplication: vi.fn(),
  getRoleAssignment: vi.fn(),
  getApplicationById: vi.fn(),
}))
vi.mock("@/lib/mou/approval-token", () => ({ createApprovalToken: vi.fn().mockResolvedValue("raw-token") }))
vi.mock("@/lib/mou/notify", () => ({
  sendApplicantConfirmation: vi.fn(),
  sendSecretaryApprovalRequest: vi.fn(),
  sendFyiNotification: vi.fn(),
}))

import { POST } from "@/app/api/mou/applications/route"
import { createApplication, getRoleAssignment } from "@/lib/mou/supabase-helpers"

const validBody = {
  application_type_id: "fmas",
  organizer_name: "Dr. Test",
  email: "organizer@example.com",
  phone_number: "9999999999",
  primary_institution: "Test Hospital",
  preferred_date_1: "2026-12-01",
  agree_terms: true,
  certify_accurate: true,
  authority_confirm: true,
}

describe("POST /api/mou/applications", () => {
  beforeEach(() => {
    vi.mocked(createApplication).mockResolvedValue({ id: "app-1", ...validBody } as any)
    vi.mocked(getRoleAssignment).mockResolvedValue({ name: "Dr. Biswarup Bose", email: "sec@example.com", phone: null })
  })

  it("rejects when the required agreement checkboxes are missing", async () => {
    const req = new Request("http://test/api/mou/applications", {
      method: "POST",
      body: JSON.stringify({ ...validBody, agree_terms: false }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
  })

  it("creates the application when the payload is valid", async () => {
    const req = new Request("http://test/api/mou/applications", {
      method: "POST",
      body: JSON.stringify(validBody),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe(true)
    expect(body.applicationId).toBe("app-1")
    expect(createApplication).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-api-applications.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/mou/applications/route'"

- [ ] **Step 6: Write `src/app/api/mou/applications/route.ts`**

```typescript
// @auth: public — creates a new academic-event MOU application. The
// applicant must already have a verified otp_codes row for their email
// (checked here, not re-verified — verifyMouOtp already marked it
// `verified: true` when they completed the OTP step in the form).
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { createApplication, getRoleAssignment } from "@/lib/mou/supabase-helpers"
import { createApprovalToken } from "@/lib/mou/approval-token"
import { sendApplicantConfirmation, sendSecretaryApprovalRequest, sendFyiNotification } from "@/lib/mou/notify"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { checkRateLimit } from "@/lib/rate-limit"
import type { NewApplicationInput } from "@/lib/mou/types"

const REQUIRED_FIELDS = [
  "application_type_id", "organizer_name", "email", "phone_number",
  "primary_institution", "preferred_date_1",
] as const

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-application:${ip}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return Response.json({ status: false, message: "Too many submissions. Please try later." }, { status: 429 })

  const body = (await request.json()) as NewApplicationInput
  for (const field of REQUIRED_FIELDS) {
    if (!body[field]) return Response.json({ status: false, message: `${field} is required` }, { status: 400 })
  }
  if (!body.agree_terms || !body.certify_accurate || !body.authority_confirm) {
    return Response.json({ status: false, message: "All three agreement checkboxes are required" }, { status: 400 })
  }
  const typeConfig = getEventTypeConfig(body.application_type_id)
  if (!typeConfig) return Response.json({ status: false, message: "Unknown application type" }, { status: 400 })
  if (typeConfig.fields.includes("zone") && !body.zone) {
    return Response.json({ status: false, message: "Zone is required for this event type" }, { status: 400 })
  }

  // Confirm this email completed OTP verification (verifyMouOtp sets
  // otp_codes.verified=true; we require a verified row within the last
  // hour so a stale verification from an unrelated form can't be replayed).
  const supabase = createAdminClient()
  const { data: verifiedOtp } = await supabase
    .from("otp_codes")
    .select("id")
    .eq("email", body.email.toLowerCase())
    .eq("verified", true)
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!verifiedOtp) {
    return Response.json({ status: false, message: "Please verify your email with the code first" }, { status: 400 })
  }

  const application = await createApplication(body)

  await sendApplicantConfirmation(application)

  const secretary = await getRoleAssignment("hon_secretary")
  if (secretary) {
    const token = await createApprovalToken(application.id, "hon_secretary", true)
    const magicLinkUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${token}`
    await sendSecretaryApprovalRequest(application, typeConfig.label, secretary.email, magicLinkUrl)
  }

  const president = await getRoleAssignment("president")
  if (president) {
    const { createApprovalToken: mkToken } = await import("@/lib/mou/approval-token")
    const token = await mkToken(application.id, "president", false)
    const viewUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${token}`
    await sendFyiNotification(application, typeConfig.label, president.email, "president", viewUrl)
  }

  if (typeConfig.fields.includes("zone") && body.zone) {
    const zoneRole = `zone_chair_${body.zone.toLowerCase()}`
    const zoneChair = await getRoleAssignment(zoneRole)
    if (zoneChair) {
      const { createApprovalToken: mkToken } = await import("@/lib/mou/approval-token")
      const token = await mkToken(application.id, zoneRole, false)
      const viewUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${token}`
      await sendFyiNotification(application, typeConfig.label, zoneChair.email, zoneRole, viewUrl)
    }
  }

  return Response.json({ status: true, applicationId: application.id })
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-api-applications.test.ts`
Expected: PASS (2 tests) — note the test file mocks `@/lib/supabase` implicitly is NOT set up in Step 4's test; add `vi.mock("@/lib/supabase", () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ gte: () => ({ order: () => ({ limit: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: "otp-1" } }) }) }) }) }) }) }) }) }) }))` at the top of the test file before the imports, so the OTP-verified check in the route passes during the test.

- [ ] **Step 8: Write `src/app/api/mou/applications/[id]/route.ts`**

```typescript
// @auth: public — status lookup by application id. The id (a UUID) acts
// as the capability token; there is no separate login for applicants.
import { NextRequest } from "next/server"
import { getApplicationById } from "@/lib/mou/supabase-helpers"
import { createAdminClient } from "@/lib/supabase"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  const supabase = createAdminClient()
  const { data: remarks } = await supabase
    .from("academic_event_remarks")
    .select("author_name, author_role, body, created_at")
    .eq("application_id", id)
    .order("created_at", { ascending: true })

  return Response.json({
    status: true,
    application: {
      id: application.id,
      application_type_id: application.application_type_id,
      status: application.status,
      organizer_name: application.organizer_name,
      event_name: application.event_name,
      created_at: application.created_at,
      reviewed_at: application.reviewed_at,
      rejection_reason: application.rejection_reason,
    },
    remarks: remarks ?? [],
  })
}
```

- [ ] **Step 9: Add all 5 routes to `PUBLIC_API_ROUTES` in `src/middleware.ts`**

Read the existing `PUBLIC_API_ROUTES` array first (grep `PUBLIC_API_ROUTES` in `src/middleware.ts`) and append these 5 entries following its exact existing string format:
`/api/mou/otp/send`, `/api/mou/otp/verify`, `/api/mou/member-lookup`, `/api/mou/applications` (POST-only route, but the allowlist is path-based per existing convention), `/api/mou/applications/` (with trailing slash or whatever prefix-match convention the existing array already uses for dynamic `[id]` routes — check how `/api/applications/` or similar existing dynamic routes are listed and match that exact pattern).

- [ ] **Step 10: Commit**

```bash
git add src/app/api/mou/otp src/app/api/mou/member-lookup src/app/api/mou/applications src/middleware.ts __tests__/mou-api-applications.test.ts
git commit -m "feat(mou): add public OTP, lookup, and application submission routes"
```

---

### Task 9: Review (magic link) API routes

**Files:**
- Create: `src/app/api/mou/review/[token]/route.ts`
- Create: `src/app/api/mou/review/[token]/decide/route.ts`
- Create: `src/app/api/mou/applications/[id]/remarks/route.ts`
- Modify: `src/middleware.ts` (add these to `PUBLIC_API_ROUTES` — they're public but token-gated, same category as the routes in Task 8)
- Test: `__tests__/mou-api-review.test.ts`

**Interfaces:**
- Consumes: `verifyApprovalToken`, `markTokenUsed` (Task 4); `getApplicationById`, `updateApplicationStatus`, `createRemark` (Task 5); `generateMouPdf` (Task 6); `sendOutcomeEmail`, `sendWhatsAppNudge` (Task 7); `getEventTypeConfig` (Task 2).
- Produces: the 3 route handlers Task 11's review page calls.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/mou-api-review.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/mou/approval-token", () => ({
  verifyApprovalToken: vi.fn(),
  markTokenUsed: vi.fn(),
}))
vi.mock("@/lib/mou/supabase-helpers", () => ({
  getApplicationById: vi.fn(),
  updateApplicationStatus: vi.fn(),
  createRemark: vi.fn(),
}))
vi.mock("@/lib/mou/mou-pdf", () => ({ generateMouPdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-fake")) }))
vi.mock("@/lib/mou/notify", () => ({ sendOutcomeEmail: vi.fn(), sendWhatsAppNudge: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createAdminClient: () => ({ storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ data: { path: "x" }, error: null }), getPublicUrl: () => ({ data: { publicUrl: "https://example.com/mou.pdf" } }) }) } }) }))

import { POST as decidePOST } from "@/app/api/mou/review/[token]/decide/route"
import { verifyApprovalToken } from "@/lib/mou/approval-token"
import { getApplicationById, updateApplicationStatus } from "@/lib/mou/supabase-helpers"

describe("POST /api/mou/review/[token]/decide", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects an invalid token", async () => {
    vi.mocked(verifyApprovalToken).mockResolvedValue({ ok: false, message: "invalid" })
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ action: "approved" }) })
    const res = await decidePOST(req as any, { params: Promise.resolve({ token: "bad" }) })
    expect(res.status).toBe(400)
  })

  it("rejects a token without decide permission", async () => {
    vi.mocked(verifyApprovalToken).mockResolvedValue({ ok: true, row: { id: "t1", application_id: "app-1", role: "president", can_decide: false } })
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ action: "approved" }) })
    const res = await decidePOST(req as any, { params: Promise.resolve({ token: "raw" }) })
    expect(res.status).toBe(403)
  })

  it("approves and updates the application status when the token can decide", async () => {
    vi.mocked(verifyApprovalToken).mockResolvedValue({ ok: true, row: { id: "t1", application_id: "app-1", role: "hon_secretary", can_decide: true } })
    vi.mocked(getApplicationById).mockResolvedValue({
      id: "app-1", application_type_id: "fmas", organizer_name: "Dr. Test", email: "o@example.com",
      phone_number: "9999999999", mou_version: 0,
    } as any)
    const req = new Request("http://test", { method: "POST", body: JSON.stringify({ action: "approved" }) })
    const res = await decidePOST(req as any, { params: Promise.resolve({ token: "raw" }) })
    expect(res.status).toBe(200)
    expect(updateApplicationStatus).toHaveBeenCalledWith("app-1", "approved", expect.objectContaining({ reviewed_by: "hon_secretary" }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-api-review.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/mou/review/[token]/decide/route'"

- [ ] **Step 3: Write `src/app/api/mou/review/[token]/route.ts`**

```typescript
// @auth: public but token-gated — the magic link's landing summary.
import { NextRequest } from "next/server"
import { verifyApprovalToken } from "@/lib/mou/approval-token"
import { getApplicationById } from "@/lib/mou/supabase-helpers"
import { createAdminClient } from "@/lib/supabase"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const verified = await verifyApprovalToken(token)
  if (!verified.ok) return Response.json({ status: false, message: verified.message }, { status: 400 })

  const application = await getApplicationById(verified.row.application_id)
  if (!application) return Response.json({ status: false, message: "Application not found" }, { status: 404 })

  const supabase = createAdminClient()
  const { data: remarks } = await supabase
    .from("academic_event_remarks")
    .select("author_name, author_role, body, created_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: true })

  return Response.json({
    status: true,
    canDecide: verified.row.can_decide,
    role: verified.row.role,
    application,
    remarks: remarks ?? [],
  })
}
```

- [ ] **Step 4: Write `src/app/api/mou/review/[token]/decide/route.ts`**

```typescript
// @auth: public but token-gated — the Hon. Secretary's one decision.
import { NextRequest } from "next/server"
import { verifyApprovalToken, markTokenUsed } from "@/lib/mou/approval-token"
import { getApplicationById, updateApplicationStatus } from "@/lib/mou/supabase-helpers"
import { generateMouPdf } from "@/lib/mou/mou-pdf"
import { sendOutcomeEmail, sendWhatsAppNudge } from "@/lib/mou/notify"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { createAdminClient } from "@/lib/supabase"

const VALID_ACTIONS = ["approved", "rejected", "changes_requested"] as const

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { action, notes } = await request.json()
  if (!VALID_ACTIONS.includes(action)) {
    return Response.json({ status: false, message: "Invalid action" }, { status: 400 })
  }

  const verified = await verifyApprovalToken(token)
  if (!verified.ok) return Response.json({ status: false, message: verified.message }, { status: 400 })
  if (!verified.row.can_decide) {
    return Response.json({ status: false, message: "This link cannot make a decision" }, { status: 403 })
  }

  const application = await getApplicationById(verified.row.application_id)
  if (!application) return Response.json({ status: false, message: "Application not found" }, { status: 404 })

  const typeConfig = getEventTypeConfig(application.application_type_id)
  const typeLabel = typeConfig?.label ?? application.application_type_id

  let mouUrl: string | undefined
  let mouBuffer: Buffer | undefined
  if (action === "approved") {
    mouBuffer = await generateMouPdf(application, typeLabel)
    const supabase = createAdminClient()
    const fileName = `mou/${application.id}-v${application.mou_version + 1}.pdf`
    await supabase.storage.from("uploads").upload(fileName, mouBuffer, { contentType: "application/pdf", upsert: true })
    const { data: publicUrlData } = supabase.storage.from("uploads").getPublicUrl(fileName)
    mouUrl = publicUrlData.publicUrl
  }

  await updateApplicationStatus(application.id, action, {
    reviewed_by: verified.row.role,
    reviewed_at: new Date().toISOString(),
    rejection_reason: action !== "approved" ? notes : null,
    ...(mouUrl ? { mou_generated_url: mouUrl, mou_version: application.mou_version + 1 } : {}),
  })

  await markTokenUsed(token, action)
  await sendOutcomeEmail(application, typeLabel, action, mouBuffer)
  await sendWhatsAppNudge(application, action)

  return Response.json({ status: true })
}
```

- [ ] **Step 5: Write `src/app/api/mou/applications/[id]/remarks/route.ts`**

```typescript
// @auth: public but token-gated (query ?token=) — non-blocking remark
// from a notified party. Never gates or changes application status.
import { NextRequest } from "next/server"
import { verifyApprovalToken } from "@/lib/mou/approval-token"
import { createRemark } from "@/lib/mou/supabase-helpers"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = request.nextUrl.searchParams.get("token")
  const { body: remarkBody } = await request.json()
  if (!token || !remarkBody || typeof remarkBody !== "string" || !remarkBody.trim()) {
    return Response.json({ status: false, message: "token and body are required" }, { status: 400 })
  }

  const verified = await verifyApprovalToken(token)
  if (!verified.ok || verified.row.application_id !== id) {
    return Response.json({ status: false, message: "Invalid link for this application" }, { status: 400 })
  }

  await createRemark(id, verified.row.role, verified.row.role, remarkBody.trim())
  return Response.json({ status: true })
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-api-review.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Add the 3 new routes to `PUBLIC_API_ROUTES` in `src/middleware.ts`**, same pattern as Task 8 Step 9.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/mou/review src/app/api/mou/applications/[id]/remarks src/middleware.ts __tests__/mou-api-review.test.ts
git commit -m "feat(mou): add magic-link review, decide, and remarks routes"
```

---

### Task 10: Admin API routes and event auto-creation on approval

**Files:**
- Create: `src/app/api/admin/mou-applications/route.ts`
- Create: `src/app/api/admin/mou-applications/[id]/route.ts`
- Modify: `src/app/api/mou/review/[token]/decide/route.ts` (add event-creation call on approval)
- Test: `__tests__/mou-api-admin.test.ts`

**Interfaces:**
- Consumes: `getAdminSession`, `adminReviewerId` from `src/lib/auth.ts`; `logAdminAction` from `src/lib/audit-log.ts`; `listApplications`, `getApplicationById` (Task 5).
- Produces: admin list/detail endpoints Task 11's `/admin/mou-applications` page calls; extends the decide route to create a row in the shared `events` table.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/mou-api-admin.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ getAdminSession: vi.fn() }))
vi.mock("@/lib/mou/supabase-helpers", () => ({ listApplications: vi.fn() }))

import { GET } from "@/app/api/admin/mou-applications/route"
import { getAdminSession } from "@/lib/auth"
import { listApplications } from "@/lib/mou/supabase-helpers"

describe("GET /api/admin/mou-applications", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401s when there is no admin session", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null)
    const req = new Request("http://test/api/admin/mou-applications")
    const res = await GET(req as any)
    expect(res.status).toBe(401)
  })

  it("returns the list when an admin session exists", async () => {
    vi.mocked(getAdminSession).mockResolvedValue({ sub: "admin-1", role: "admin" } as any)
    vi.mocked(listApplications).mockResolvedValue({ rows: [], total: 0 })
    const req = new Request("http://test/api/admin/mou-applications")
    const res = await GET(req as any)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-api-admin.test.ts`
Expected: FAIL with "Cannot find module '@/app/api/admin/mou-applications/route'"

- [ ] **Step 3: Write `src/app/api/admin/mou-applications/route.ts`**

```typescript
// @auth: admin
import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { listApplications } from "@/lib/mou/supabase-helpers"

export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const type = request.nextUrl.searchParams.get("type") ?? undefined
  const status = request.nextUrl.searchParams.get("status") ?? undefined
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50")
  const offset = Number(request.nextUrl.searchParams.get("offset") ?? "0")

  const result = await listApplications({ type, status, limit, offset })
  return Response.json({ status: true, ...result })
}
```

- [ ] **Step 4: Write `src/app/api/admin/mou-applications/[id]/route.ts`**

```typescript
// @auth: admin
import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { getApplicationById } from "@/lib/mou/supabase-helpers"
import { createAdminClient } from "@/lib/supabase"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  const supabase = createAdminClient()
  const { data: remarks } = await supabase
    .from("academic_event_remarks")
    .select("*")
    .eq("application_id", id)
    .order("created_at", { ascending: true })

  return Response.json({ status: true, application, remarks: remarks ?? [] })
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-api-admin.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Extend the decide route to create the event record on approval**

Modify `src/app/api/mou/review/[token]/decide/route.ts` from Task 9: inside the `if (action === "approved")` block, after the MOU is uploaded, insert into the shared `events` table using the exact columns confirmed by this session's research (`name`, `short_name`, `description`, `start_date`, `end_date`, `venue`, `city`, `state`, `country`, `timezone`), and store the new event's id back onto the application via `created_event_id`:

```typescript
  if (action === "approved") {
    mouBuffer = await generateMouPdf(application, typeLabel)
    const supabase = createAdminClient()
    const fileName = `mou/${application.id}-v${application.mou_version + 1}.pdf`
    await supabase.storage.from("uploads").upload(fileName, mouBuffer, { contentType: "application/pdf", upsert: true })
    const { data: publicUrlData } = supabase.storage.from("uploads").getPublicUrl(fileName)
    mouUrl = publicUrlData.publicUrl

    const { data: eventRow, error: eventError } = await supabase
      .from("events")
      .insert({
        name: application.event_name || `${typeLabel} — ${application.organizer_name}`,
        short_name: typeLabel,
        description: `${typeLabel} hosted by ${application.organizer_name} at ${application.primary_institution}`,
        start_date: application.finalized_date || application.preferred_date_1,
        end_date: application.finalized_date || application.preferred_date_1,
        venue: application.venue_name,
        city: application.venue_city,
        state: application.venue_state,
        country: application.venue_country || "India",
        timezone: "Asia/Kolkata",
      })
      .select("id")
      .single()

    if (!eventError && eventRow) {
      createdEventId = eventRow.id
    } else if (eventError) {
      // Event-record creation failing must never lose the approval itself
      // (per the spec's retry/observability requirement) — log and continue.
      const Sentry = await import("@sentry/nextjs")
      Sentry.captureException(new Error(`Failed to auto-create event for MOU application ${application.id}: ${eventError.message}`))
    }
  }
```

Add `let createdEventId: string | undefined` near the top of the function (alongside the existing `let mouUrl: string | undefined`), and add `...(createdEventId ? { created_event_id: createdEventId } : {})` to the `updateApplicationStatus` call's fields object.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/mou-applications src/app/api/mou/review/[token]/decide/route.ts __tests__/mou-api-admin.test.ts
git commit -m "feat(mou): add admin API routes and auto-create event on approval"
```

---

### Task 11: Public pages — landing, application form, status, review

**Files:**
- Create: `src/components/mou/application-form.tsx`
- Create: `src/components/mou/status-badge.tsx`
- Create: `src/app/mou/page.tsx`
- Create: `src/app/mou/[type]/page.tsx`
- Create: `src/app/mou/status/[id]/page.tsx`
- Create: `src/app/mou/review/[token]/page.tsx`

**Interfaces:**
- Consumes: `EVENT_TYPE_CONFIG`, `getEventTypeConfig` (Task 2); the API routes from Tasks 8-9; shadcn components from `src/components/ui/` (`Button`, `Card`, `Input`, `Label`, `Checkbox`, `Badge` — read `src/components/ui/` directory first to confirm exact prop names before use, e.g. this repo's existing `src/app/apply/page.tsx` for the established form-field pattern).

This task is UI-heavy and the exact JSX is intentionally not fully specified line-by-line here (that would multiply this plan's length without adding safety — the API contracts above are the part that must be exact). Follow `AGENTS.md` §1-3 for every screen: check `src/app/apply/page.tsx` for the closest existing form pattern before writing new JSX, use `src/components/ui/` primitives, no gradients, hairline borders.

- [ ] **Step 1: Build `src/components/mou/status-badge.tsx`** — a small component mapping `ApplicationStatus` to a colored-dot + lowercase label (per `AGENTS.md` "Status shown as a small colored dot + lowercase text, not a filled chip").

- [ ] **Step 2: Build `src/app/mou/page.tsx`** — server or client component rendering a card grid: one `Card` per `Object.values(EVENT_TYPE_CONFIG)` entry linking to `/mou/${id}`, plus a second section listing the 5 static document links (exact URLs from Task 8's spec doc, §1 of the design doc) that stay outside the native-form system: Application for Hosting AMASICON (.docx), MOU for AMASICON (.pdf), MOU for Workshop CME Conference (.pdf), MOU for Rural Surgery Camp (.pdf), Process of Hosting AMASI Academic Event (.docx) — with a note that AMASICON hosting bids go through the Executive Committee.

- [ ] **Step 3: Build `src/components/mou/application-form.tsx`** — client component, props `{ typeId: ApplicationTypeId }`. Steps: (a) membership number/email input → `GET /api/mou/member-lookup?q=` → prefill name/institution if matched; (b) common fields (organizer_name, email, phone_number, primary_institution, preferred_date_1/2, venue_*) always rendered, pre-filled from lookup where available; (c) conditionally rendered fields per `getEventTypeConfig(typeId).fields`; (d) the 3 agreement checkboxes; (e) "Send verification code" button → `POST /api/mou/otp/send`; (f) code input → `POST /api/mou/otp/verify`; (g) on verify success, "Submit application" → `POST /api/mou/applications`; (h) on success, redirect to `/mou/status/${applicationId}`.

- [ ] **Step 4: Build `src/app/mou/[type]/page.tsx`** — reads `type` from the route param (this uses a dynamic segment, not `useSearchParams`, so no `<Suspense>` wrapper is required per the Global Constraints rule — confirm this is genuinely a server-renderable param read, not a client hook, before skipping Suspense), calls `getEventTypeConfig(type)`, 404s via `notFound()` from `next/navigation` if unknown, otherwise renders `<ApplicationForm typeId={type} />`.

- [ ] **Step 5: Build `src/app/mou/status/[id]/page.tsx`** — fetches `GET /api/mou/applications/[id]`, shows status badge, key fields, and the remarks thread (read-only for the applicant).

- [ ] **Step 6: Build `src/app/mou/review/[token]/page.tsx`** — client component (needs interactive Approve/Reject/Request Changes buttons). Fetches `GET /api/mou/review/[token]` on mount, shows the full application, remarks thread, a remark textarea (`POST /api/mou/applications/[id]/remarks?token=...`), and — only when `canDecide === true` — the three decision buttons calling `POST /api/mou/review/[token]/decide`. This uses no `useSearchParams`/`usePathname`/`useRouter` (token comes from the route param), so it does not need the Suspense/build-check treatment — but verify this assumption by running `npx next build` anyway per the Global Constraints rule, since it's a dynamic-token page and worth confirming static-prerender doesn't choke on it.

- [ ] **Step 7: Manual smoke test**

Run `npm run dev`, then in a browser:
1. Visit `/mou` — confirm 9 cards + 5 static links render.
2. Visit `/mou/fmas` — confirm the form renders with FMAS-specific fields (auditorium checkboxes, photo uploads) and NOT workshop-specific fields (event_name).
3. Submit a test application with a real email you control — confirm the OTP email arrives, verification succeeds, and submission redirects to a status page showing "submitted."
4. Check the Secretary's configured email inbox (or a Resend test log) for the approval-request email with a working magic link.

- [ ] **Step 8: Run the full test suite and typecheck**

```bash
cd ~/amasi-membership && npx vitest run && npx tsc --noEmit && npx eslint .
```
Expected: all pass, zero errors.

- [ ] **Step 9: Run a production build**

```bash
npx next build
```
Expected: succeeds with no static-prerender failures on any `/mou/*` route.

- [ ] **Step 10: Commit**

```bash
git add src/components/mou src/app/mou
git commit -m "feat(mou): add public landing, application form, status, and review pages"
```

---

### Task 12: Admin record view and sidebar entries

**Files:**
- Create: `src/app/admin/mou-applications/page.tsx`
- Modify: `src/components/layout/sidebar.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/mou-applications` (Task 10); `useAdminRole()` from `src/hooks/use-admin-role.ts`.

- [ ] **Step 1: Build `src/app/admin/mou-applications/page.tsx`** — follow the exact visual pattern of `src/app/admin/fmas/page.tsx` (stats cards + filterable table): tabs or a status filter (submitted/under_review/changes_requested/approved/rejected), table columns (type, organizer, institution, dates, status, MOU link if approved), and a simple "approved, sorted by finalized_date" view as the calendar-substitute mentioned in the spec — a second tab or a `?status=approved&sort=finalized_date` query, not a calendar widget.

- [ ] **Step 2: Modify `src/components/layout/sidebar.tsx`**

Add to the `"Membership"` section's `items` array (after `{ name: "Apply", href: "/apply", icon: UserPlus }`):
```typescript
{ name: "MOU / Academic Events", href: "/mou", icon: FileSearch },
```
(reusing the already-imported `FileSearch` icon — check the top of the file first; if it's not already imported, add it to the `lucide-react` import list).

Add to the `"Admin"` section's `items` array (after `{ name: "MMAS Holders", href: "/admin/mmas", icon: Award }`):
```typescript
{ name: "MOU Applications", href: "/admin/mou-applications", icon: ScrollText },
```
(reusing the already-imported `ScrollText` icon, consistent with "Activity Log" — no new badge wiring for Phase 1; a pending-count badge is a nice-to-have deferred rather than blocking this task, per the design doc's own "use your judgment" note).

- [ ] **Step 3: Run typecheck, lint, and build**

```bash
cd ~/amasi-membership && npx tsc --noEmit && npx eslint . && npx next build
```
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/mou-applications src/components/layout/sidebar.tsx
git commit -m "feat(mou): add admin record view and sidebar navigation"
```

---

## Self-Review Notes

**Spec coverage check** (against `docs/superpowers/specs/2026-09-04-academic-event-mou-workflow-design.md`):
- §2 data model → Task 1 ✅. §3 applicant flow (lookup, OTP, magic link, remarks, event creation) → Tasks 2-3-4-5-7-8-9-10 ✅. §4 integration table → Resend/GallaBox in Task 7, WordPress/eventz360 explicitly deferred (not built) ✅. §5 phased build order → this entire plan is Phase 1 only ✅. §6 all 4 resolved open questions (zone=1 chairperson+president/secretary, Meet the Master included as 9th type, AMASICON out of scope, lean Phase 1) → reflected in Task 1's seed data and Task 2's config ✅.

**Known Phase 1 gaps, intentionally out of scope per the approved spec:** WordPress publishing, eventz360 sync, revision/resubmission path, fee/revenue-share step, post-event report. Do not build these without a new spec update.

**One operational dependency to flag to the user before Task 7 goes live:** the GallaBox WhatsApp template `mou_application_outcome` referenced in `src/lib/mou/notify.ts` must be created and approved in the GallaBox dashboard first — `sendTemplate` degrades gracefully (`{success:false}`, never throws) if it's missing, so this doesn't block deployment, but WhatsApp nudges silently won't send until that template exists.

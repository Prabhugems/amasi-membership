# MOU Application Framework (Rural Surgery Camp + Workshop/CME/Conference) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Realign the `rural_program` and `workshop` MOU application types to their real 25/26-clause legal text, via one shared config-driven MOU application framework (not two one-off forms), with a new append-only electronic-signature record.

**Architecture:** One `MouEventTypeConfig` shape carries each type's MOU clause text, declarations, business rules, and a declarative `typeSpecificFields[]` array. One generic form section, one generic server-side validator, and one shared upload/OTP/signature pipeline serve both types; the other 7 existing MOU types (fmas/mmas/dmas/slcp/nextgen/meet_the_master/zonal_event) are untouched. `type_specific_data jsonb` holds whatever's unique to one type, so a third type needs no new migration.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + Storage), Vitest, `@react-pdf/renderer`.

**Spec:** `docs/superpowers/specs/2026-09-04-mou-application-framework-design.md` — read this first. Also read its two source specs directly for exact copy: `/Users/prabhubalasubramaniam/Downloads/Rural Camp Membership Form.md` and `/Users/prabhubalasubramaniam/Downloads/Rural Program Membership Access MOU Spec (1).md` (the latter is the Workshop/CME/Conference spec despite its filename).

## Global Constraints

- RLS enabled, no policies, on every new table — service-role admin client only (house style, `sql/039`).
- Migration is a **new file** (`sql/040_mou_application_framework.sql`) — `sql/039` is never edited.
- `mou_signatures` is insert-only from application code except one narrow exception: `approved_by`/`approved_at` are set exactly once, by the decide route, on approval. No other UPDATE or DELETE against this table, anywhere, ever.
- `mou_sha256` is always computed **server-side** from `typeConfig.mouClauses` + `typeConfig.mouVersion` — never accepted from the client.
- IP address is extracted via the existing `x-forwarded-for` pattern (see `upload/route.ts`, `rate-limit.ts` usage) — never trust a client-supplied IP field.
- `faculty` jsonb array: 1–20 rows. `partner_associations` jsonb array: 0–10 rows. Enforced both client- and server-side.
- The other 7 existing `EVENT_TYPE_CONFIG` entries (fmas, mmas, dmas, slcp, nextgen, meet_the_master, zonal_event) must see **zero behavior change** — no new required fields, no new sections, no changed validation.
- **Naming collision to not conflate:** `AcademicEventApplication.mou_version` (existing column, defaults to 0, incremented in `decide/route.ts` as `application.mou_version + 1` — this is a PDF-generation-revision counter, used in the storage filename and the admin "Download MOU (vN)" link) is a **completely different concept** from `MouEventTypeConfig.mouVersion` / `mou_signatures.mou_version` (which edition of the legal clause *text* the signer saw). Do not read or write `application.mou_version` from any new signature code, and do not let `mou_signatures.mou_version` feed into the PDF filename/footer logic. Both must keep working exactly as they do today, independently.
- This codebase has no component-testing setup (no `@testing-library/react`, no jsdom test config — confirmed against `package.json`). Component tasks below extract their core logic (scroll-to-end detection, field-value derivation) into plain exported functions that get Vitest unit tests; the React component itself wires them up untested, matching this codebase's existing convention (no other MOU component has its own test file).
- **File-scope note (added after Task 1's review):** several new `AcademicEventApplication` fields (`joint_programme`, `faculty`, `type_specific_data`) are non-optional. Any existing file constructing an `AcademicEventApplication`-typed object *literal* (not a DB row via `as` cast) will fail `tsc` until it adds the new fields — Task 1 found and fixed the two such files (`__tests__/mou-notify.test.ts`, `__tests__/mou-pdf.test.ts`). A task whose stated file list doesn't include a file `tsc` reports as broken by this ripple should fix it there anyway (minimal fix: add the new fields with sensible defaults, nothing else) and note the deviation plainly in its report — this is expected and approved, not a scope violation.

---

### Task 1: Migration + type definitions

**Files:**
- Create: `sql/040_mou_application_framework.sql`
- Modify: `src/lib/mou/types.ts`
- Test: `__tests__/mou-migration-040.test.ts`

**Interfaces:**
- Produces: `MouSignature` interface (consumed by Task 2's `mou-signature.ts` and Task 9's decide route); extended `AcademicEventApplication`/`NewApplicationInput` (consumed by every later task).

- [ ] **Step 1: Write the migration file**

```sql
-- 040_mou_application_framework.sql
-- Shared columns + append-only signature table for the config-driven MOU
-- application framework (rural_program + workshop today; any future
-- MOU-workflow type without another migration for its own extra fields —
-- see type_specific_data below). Run manually in the Supabase SQL editor —
-- this repo does not apply schema migrations via MCP execute_sql (DML only).

alter table public.academic_event_applications
  add column if not exists amasi_year_of_joining        integer check (amasi_year_of_joining is null or amasi_year_of_joining between 1993 and extract(year from now())::int),
  add column if not exists designation                   text,
  add column if not exists proposed_registration_fee      numeric(10, 2) check (proposed_registration_fee is null or proposed_registration_fee >= 0),
  add column if not exists programme_outline               text,
  add column if not exists institution_type                 text check (institution_type is null or institution_type in ('own', 'guest', 'private')),
  add column if not exists joint_programme                   boolean not null default false,
  add column if not exists partner_associations               jsonb not null default '[]'::jsonb,
  add column if not exists consent_guest_institution_url        text,
  add column if not exists brief_institution_url                 text,
  add column if not exists faculty                                jsonb not null default '[]'::jsonb,
  add column if not exists agreements                              jsonb,
  add column if not exists type_specific_data                      jsonb not null default '{}'::jsonb;

comment on column public.academic_event_applications.partner_associations is
  'jsonb array, max 10 entries enforced in application code: [{name: text, consent_letter_url: text}]';
comment on column public.academic_event_applications.faculty is
  'jsonb array, max 20 entries enforced in application code: [{name: text, amasi_membership_number: text|null, speciality: text|null, is_amasi_member: boolean}]';
comment on column public.academic_event_applications.agreements is
  'jsonb object: {"<clauseRef>": "<ISO timestamp accepted>", ...} — shape is shared, content is per-type (see MouEventTypeConfig.agreements)';
comment on column public.academic_event_applications.type_specific_data is
  'jsonb object holding fields unique to one event type, plus a "_v" schema-version key. rural_program keys: venue_setting, expected_beneficiaries, target_population, expected_surgeries, financial_assistance_requested, nearest_airport, nearest_airport_km, nearest_railhead, nearest_railhead_km, facilities{...}. workshop keys: event_subtype, expected_delegates, faculty_travel_mode, organised_by_state_chapter, small_state_exception_requested, small_state_faculty_count, email_circular_requested, facilities{...}.';

-- Append-only electronic-signature record. Type-agnostic — used by both
-- rural_program and workshop, and any future type that adopts the same
-- acceptance flow. Insert-only except one narrow exception: approved_by/
-- approved_at, set exactly once by the decide route on approval (the Hon.
-- Secretary's counter-signature). No other UPDATE or DELETE, ever.
create table if not exists public.mou_signatures (
  id                     uuid primary key default gen_random_uuid(),
  application_id         uuid not null references public.academic_event_applications(id) on delete cascade,
  mou_version            integer not null,
  mou_sha256             text not null,
  signatory_name         text not null,
  signatory_email        text not null,
  signatory_amasi_number text,
  otp_verified_at        timestamptz not null,
  accepted_at            timestamptz not null default now(),
  ip_address             text not null,
  user_agent             text,
  approved_by            text,
  approved_at            timestamptz,
  created_at             timestamptz not null default now(),
  unique (application_id, mou_version)
);

create index if not exists mou_signatures_application_idx
  on public.mou_signatures (application_id);

-- RLS enabled, no policies — default-deny, matching every other table in
-- this schema (sql/039). All access is via the service-role admin client.
alter table public.mou_signatures enable row level security;
```

- [ ] **Step 2: Write a text-based assertion test** (no live DB in the worktree — this checks the migration file itself is complete and additive)

```typescript
// __tests__/mou-migration-040.test.ts
import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"

const sql = readFileSync(join(process.cwd(), "sql/040_mou_application_framework.sql"), "utf-8")

describe("sql/040_mou_application_framework.sql", () => {
  it("only uses additive ALTER TABLE (add column if not exists)", () => {
    const alterLines = sql.split("\n").filter((l) => /^\s*(alter table|add column|drop column)/i.test(l.trim()))
    for (const line of alterLines) {
      if (/drop column|drop table|alter column.*type/i.test(line)) {
        throw new Error(`Non-additive migration statement found: ${line}`)
      }
    }
  })

  it("adds every shared column type_specific_validation.ts and application-form.tsx will need", () => {
    const expectedColumns = [
      "amasi_year_of_joining", "designation", "proposed_registration_fee",
      "programme_outline", "institution_type", "joint_programme",
      "partner_associations", "consent_guest_institution_url",
      "brief_institution_url", "faculty", "agreements", "type_specific_data",
    ]
    for (const col of expectedColumns) {
      expect(sql).toContain(col)
    }
  })

  it("creates mou_signatures with every column the MouSignature interface needs", () => {
    expect(sql).toContain("create table if not exists public.mou_signatures")
    const signatureColumns = [
      "application_id", "mou_version", "mou_sha256", "signatory_name",
      "signatory_email", "signatory_amasi_number", "otp_verified_at",
      "accepted_at", "ip_address", "user_agent", "approved_by", "approved_at",
    ]
    for (const col of signatureColumns) {
      expect(sql).toContain(col)
    }
  })

  it("enables RLS on mou_signatures with no policies (house style)", () => {
    expect(sql).toContain("alter table public.mou_signatures enable row level security")
    expect(sql).not.toMatch(/create policy.*mou_signatures/i)
  })

  it("never touches sql/039's existing tables destructively", () => {
    expect(sql).not.toMatch(/drop table/i)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run __tests__/mou-migration-040.test.ts`
Expected: FAIL — `sql/040_mou_application_framework.sql` doesn't exist yet (file not found on `readFileSync`).

- [ ] **Step 4: The migration file from Step 1 already satisfies the test — run it to confirm**

Run: `npx vitest run __tests__/mou-migration-040.test.ts`
Expected: PASS (all 5 assertions)

- [ ] **Step 5: Extend `src/lib/mou/types.ts`**

Add to `AcademicEventApplication` (after `institution_photo_url: string | null`, before `mou_generated_url`):

```typescript
  amasi_year_of_joining: number | null
  designation: string | null
  proposed_registration_fee: number | null
  programme_outline: string | null
  institution_type: "own" | "guest" | "private" | null
  joint_programme: boolean
  partner_associations: { name: string; consent_letter_url: string | null }[]
  consent_guest_institution_url: string | null
  brief_institution_url: string | null
  faculty: { name: string; amasi_membership_number: string | null; speciality: string | null; is_amasi_member: boolean }[]
  agreements: Record<string, string> | null
  type_specific_data: Record<string, unknown>
```

Add the same fields (all optional, `?`) to `NewApplicationInput` after `institution_photo_url?: string`:

```typescript
  amasi_year_of_joining?: number
  designation?: string
  proposed_registration_fee?: number
  programme_outline?: string
  institution_type?: "own" | "guest" | "private"
  joint_programme?: boolean
  partner_associations?: { name: string; consent_letter_url: string | null }[]
  consent_guest_institution_url?: string
  brief_institution_url?: string
  faculty?: { name: string; amasi_membership_number: string | null; speciality: string | null; is_amasi_member: boolean }[]
  agreements?: Record<string, string>
  type_specific_data?: Record<string, unknown>
```

Add a new exported interface at the end of the file:

```typescript
export interface MouSignature {
  id: string
  application_id: string
  mou_version: number
  mou_sha256: string
  signatory_name: string
  signatory_email: string
  signatory_amasi_number: string | null
  otp_verified_at: string
  accepted_at: string
  ip_address: string
  user_agent: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
}
```

- [ ] **Step 6: Run the full type-check to verify nothing broke**

Run: `npx tsc --noEmit`
Expected: PASS (these are pure additions — no existing code references the new fields yet, so nothing can break from an added-but-unused optional field)

- [ ] **Step 7: Commit**

```bash
git add sql/040_mou_application_framework.sql src/lib/mou/types.ts __tests__/mou-migration-040.test.ts
git commit -m "feat(mou): add shared framework migration + types (rural/workshop)"
```

---

### Task 2: `mou-signature.ts` — hash + signature record helpers

**Files:**
- Create: `src/lib/mou/mou-signature.ts`
- Test: `__tests__/mou-signature.test.ts`

**Interfaces:**
- Consumes: `MouSignature` (Task 1).
- Produces: `computeMouHash(clauses: string[], version: number): string`, `createMouSignature(input: CreateSignatureInput): Promise<MouSignature>`, `markCounterSigned(applicationId: string, mouVersion: number, approvedBy: string): Promise<void>` — all consumed by Task 5 (submission route) and Task 9 (decide route).

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/mou-signature.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import crypto from "crypto"

const insertMock = vi.fn()
const selectMock = vi.fn()
const singleMock = vi.fn()
const eqMock = vi.fn()
const updateMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: insertMock,
      update: updateMock,
    }),
  }),
}))
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))

import { computeMouHash, createMouSignature, markCounterSigned } from "@/lib/mou/mou-signature"
import * as Sentry from "@sentry/nextjs"

describe("computeMouHash", () => {
  it("matches a plain sha256 of the joined clauses + version", () => {
    const clauses = ["Clause one.", "Clause two."]
    const expected = crypto.createHash("sha256").update(clauses.join("\n") + "3").digest("hex")
    expect(computeMouHash(clauses, 3)).toBe(expected)
  })

  it("produces a different hash when the version changes but text doesn't", () => {
    const clauses = ["Same text."]
    expect(computeMouHash(clauses, 1)).not.toBe(computeMouHash(clauses, 2))
  })

  it("produces a different hash when the text changes but version doesn't", () => {
    expect(computeMouHash(["Text A"], 1)).not.toBe(computeMouHash(["Text B"], 1))
  })
})

describe("createMouSignature", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    singleMock.mockResolvedValue({
      data: {
        id: "sig-1", application_id: "app-1", mou_version: 1, mou_sha256: "abc",
        signatory_name: "Dr. Test", signatory_email: "test@example.com",
        signatory_amasi_number: null, otp_verified_at: "2026-09-04T00:00:00.000Z",
        accepted_at: "2026-09-04T00:00:00.000Z", ip_address: "1.2.3.4", user_agent: "test-agent",
        approved_by: null, approved_at: null, created_at: "2026-09-04T00:00:00.000Z",
      },
      error: null,
    })
    selectMock.mockReturnValue({ single: singleMock })
    insertMock.mockReturnValue({ select: selectMock })
  })

  it("inserts a signature row and returns it", async () => {
    const result = await createMouSignature({
      applicationId: "app-1",
      mouVersion: 1,
      mouSha256: "abc",
      signatoryName: "Dr. Test",
      signatoryEmail: "test@example.com",
      signatoryAmasiNumber: null,
      otpVerifiedAt: "2026-09-04T00:00:00.000Z",
      ipAddress: "1.2.3.4",
      userAgent: "test-agent",
    })
    expect(result.id).toBe("sig-1")
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        application_id: "app-1",
        mou_version: 1,
        mou_sha256: "abc",
        ip_address: "1.2.3.4",
      })
    )
  })

  it("throws and captures to Sentry when the insert fails", async () => {
    singleMock.mockResolvedValue({ data: null, error: { message: "insert failed" } })
    await expect(
      createMouSignature({
        applicationId: "app-1", mouVersion: 1, mouSha256: "abc",
        signatoryName: "Dr. Test", signatoryEmail: "test@example.com",
        signatoryAmasiNumber: null, otpVerifiedAt: "2026-09-04T00:00:00.000Z",
        ipAddress: "1.2.3.4", userAgent: null,
      })
    ).rejects.toThrow("insert failed")
    expect(Sentry.captureException).toHaveBeenCalled()
  })
})

describe("markCounterSigned", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    eqMock.mockReturnValue({ eq: eqMock, then: undefined })
    updateMock.mockReturnValue({ eq: eqMock })
  })

  it("updates only approved_by/approved_at, scoped to application_id + mou_version", async () => {
    eqMock.mockImplementation(() => ({ eq: eqMock, resolve: undefined }))
    // Two chained .eq() calls (application_id, then mou_version) — mock the
    // second to resolve.
    const secondEq = vi.fn().mockResolvedValue({ error: null })
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
    updateMock.mockReturnValue({ eq: firstEq })

    await markCounterSigned("app-1", 1, "Dr. Biswarup Bose")

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ approved_by: "Dr. Biswarup Bose" })
    )
    const updateArg = updateMock.mock.calls[0][0]
    expect(Object.keys(updateArg).sort()).toEqual(["approved_at", "approved_by"])
    expect(firstEq).toHaveBeenCalledWith("application_id", "app-1")
    expect(secondEq).toHaveBeenCalledWith("mou_version", 1)
  })

  it("captures to Sentry (does not throw) when the update fails — decision is already persisted by this point", async () => {
    const secondEq = vi.fn().mockResolvedValue({ error: { message: "update failed" } })
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq })
    updateMock.mockReturnValue({ eq: firstEq })

    await expect(markCounterSigned("app-1", 1, "Dr. Biswarup Bose")).resolves.not.toThrow()
    expect(Sentry.captureException).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/mou-signature.test.ts`
Expected: FAIL — `src/lib/mou/mou-signature.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/mou/mou-signature.ts
import crypto from "crypto"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import type { MouSignature } from "./types"

// Server-side only. Never accept a client-supplied hash — see Global
// Constraints in the plan doc. Joining clauses with "\n" + the raw version
// number (not JSON-stringified) matches exactly what the design spec
// documents, so this function's output is reproducible from the same
// typeConfig.mouClauses/mouVersion inputs anywhere else in the codebase.
export function computeMouHash(clauses: string[], version: number): string {
  return crypto.createHash("sha256").update(clauses.join("\n") + String(version)).digest("hex")
}

export interface CreateSignatureInput {
  applicationId: string
  mouVersion: number
  mouSha256: string
  signatoryName: string
  signatoryEmail: string
  signatoryAmasiNumber: string | null
  otpVerifiedAt: string
  ipAddress: string
  userAgent: string | null
}

export async function createMouSignature(input: CreateSignatureInput): Promise<MouSignature> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("mou_signatures")
    .insert({
      application_id: input.applicationId,
      mou_version: input.mouVersion,
      mou_sha256: input.mouSha256,
      signatory_name: input.signatoryName,
      signatory_email: input.signatoryEmail,
      signatory_amasi_number: input.signatoryAmasiNumber,
      otp_verified_at: input.otpVerifiedAt,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
    })
    .select()
    .single()

  if (error || !data) {
    Sentry.captureException(error, {
      tags: { component: "mou-signature", op: "create" },
      extra: { applicationId: input.applicationId },
    })
    // Same reasoning as approval-token.ts's createApprovalToken: a caller
    // that doesn't know its signature row was never durably recorded is
    // worse than an explicit failure — the whole point of this table is a
    // legal record that actually exists. Callers (Task 5) must catch this
    // and return an error to the applicant rather than silently proceeding.
    throw new Error(error?.message || "Failed to record MOU signature")
  }
  return data as MouSignature
}

// The ONLY UPDATE this table ever receives, anywhere in the codebase — the
// Hon. Secretary's counter-signature on approval. Scoped to both
// application_id AND mou_version so it can never touch the wrong signature
// row if an application somehow had more than one (it shouldn't, given the
// unique(application_id, mou_version) constraint, but the extra scope costs
// nothing and documents intent).
export async function markCounterSigned(
  applicationId: string,
  mouVersion: number,
  approvedBy: string
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("mou_signatures")
    .update({ approved_by: approvedBy, approved_at: new Date().toISOString() })
    .eq("application_id", applicationId)
    .eq("mou_version", mouVersion)

  if (error) {
    // Don't throw: by the time this runs (Task 9's decide route) the
    // decision is already persisted. Same pattern as markTokenUsed in
    // approval-token.ts.
    Sentry.captureException(error, {
      tags: { component: "mou-signature", op: "mark-counter-signed" },
      extra: { applicationId, mouVersion },
    })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/mou-signature.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/mou/mou-signature.ts __tests__/mou-signature.test.ts
git commit -m "feat(mou): add mou-signature.ts (hash + append-only signature record)"
```

---

### Task 3: `MouEventTypeConfig` type, exported clauses, small-state list, rural + workshop config data

**Files:**
- Modify: `src/lib/mou/mou-pdf.tsx` (export `RURAL_PROGRAM_CLAUSES`, `WORKSHOP_CLAUSES` — currently module-private `const`)
- Modify: `src/lib/mou/event-type-config.ts` (add `MouEventTypeConfig`/`TypeSpecificFieldDef` types; rewrite `rural_program` and `workshop` entries as data; the other 7 entries are untouched)
- Create: `src/lib/mou/small-state-chapters.ts`
- Test: `__tests__/mou-event-type-config.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: nothing new (pure config).
- Produces: `MouEventTypeConfig`, `TypeSpecificFieldDef` (consumed by Tasks 4, 5, 7, 8), `SMALL_STATE_CHAPTER_STATES` (consumed by Task 4 and Task 8), the two rewritten config entries (consumed by every later task via `getEventTypeConfig("rural_program")`/`getEventTypeConfig("workshop")`).

- [ ] **Step 1: Export the two clause arrays**

In `src/lib/mou/mou-pdf.tsx`, change:
```typescript
const WORKSHOP_CLAUSES: string[] = [
```
to:
```typescript
export const WORKSHOP_CLAUSES: string[] = [
```
and:
```typescript
const RURAL_PROGRAM_CLAUSES: string[] = [
```
to:
```typescript
export const RURAL_PROGRAM_CLAUSES: string[] = [
```
(No other change to this file — `getNumberedClauseTemplate` still references them by their local names, which still resolve since `export const` is still a binding in the same module scope.)

- [ ] **Step 2: Run type-check to confirm the export change alone is safe**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Create `src/lib/mou/small-state-chapters.ts`**

```typescript
// The 10 states where AMASI funds 2-3 faculty's to-and-fro transport for a
// state-chapter-organised Workshop/CME/Conference (clause 17 of the
// Workshop/CME/Conference MOU — see WORKSHOP_CLAUSES in mou-pdf.tsx).
// Named export, not inlined into event-type-config.ts, because the EC
// changes this list from time to time (per the workshop spec's explicit
// "keep the eligible-state list in config, not in the component"
// requirement) — one place to edit. Spelling matches INDIAN_STATES exactly
// (src/lib/membership-types.ts) so a straight equality check against
// venue_state works with no normalization step.
export const SMALL_STATE_CHAPTER_STATES: string[] = [
  "Jammu and Kashmir",
  "Uttarakhand",
  "Himachal Pradesh",
  "Tripura",
  "Meghalaya",
  "Manipur",
  "Nagaland",
  "Arunachal Pradesh",
  "Mizoram",
  "Sikkim",
]
```

- [ ] **Step 4: Write the config-shape test first (extend the existing file)**

Add to `__tests__/mou-event-type-config.test.ts` (new `describe` block, keep the existing 4 `it`s as-is):

```typescript
import { RURAL_PROGRAM_CLAUSES, WORKSHOP_CLAUSES } from "@/lib/mou/mou-pdf"
import { SMALL_STATE_CHAPTER_STATES } from "@/lib/mou/small-state-chapters"

describe("rural_program and workshop MouEventTypeConfig", () => {
  it("both carry mouClauses matching the exported PDF clause arrays exactly", () => {
    const rural = EVENT_TYPE_CONFIG.rural_program
    const workshop = EVENT_TYPE_CONFIG.workshop
    expect(rural.mouClauses).toEqual(RURAL_PROGRAM_CLAUSES)
    expect(workshop.mouClauses).toEqual(WORKSHOP_CLAUSES)
  })

  it("both have exactly 14 agreements, each with a non-empty clauseRef and text", () => {
    for (const id of ["rural_program", "workshop"] as const) {
      const config = EVENT_TYPE_CONFIG[id]
      expect(config.agreements).toHaveLength(14)
      for (const a of config.agreements) {
        expect(a.clauseRef.length).toBeGreaterThan(0)
        expect(a.text.length).toBeGreaterThan(0)
      }
    }
  })

  it("both require venue and a 45-day lead time", () => {
    for (const id of ["rural_program", "workshop"] as const) {
      const config = EVENT_TYPE_CONFIG[id]
      expect(config.requiresVenue).toBe(true)
      expect(config.minLeadDays).toBe(45)
    }
  })

  it("both use 'Organizing Secretary name' as the organizer-name label", () => {
    expect(EVENT_TYPE_CONFIG.rural_program.organizerNameLabel).toBe("Organizing Secretary name")
    expect(EVENT_TYPE_CONFIG.workshop.organizerNameLabel).toBe("Organizing Secretary name")
  })

  it("rural_program's venue_setting field blocks Urban with the clause-4 message", () => {
    const venueField = EVENT_TYPE_CONFIG.rural_program.typeSpecificFields.find(
      (f): f is Extract<typeof f, { kind: "radio" }> => f.kind === "radio" && f.key === "venue_setting"
    )
    expect(venueField).toBeDefined()
    expect(venueField?.blockValue?.value).toBe("Urban")
    expect(venueField?.blockValue?.message).toContain("Clause 4")
  })

  it("only workshop has smallStateException, using SMALL_STATE_CHAPTER_STATES", () => {
    expect(EVENT_TYPE_CONFIG.rural_program.smallStateException).toBeUndefined()
    expect(EVENT_TYPE_CONFIG.workshop.smallStateException?.states).toBe(SMALL_STATE_CHAPTER_STATES)
  })

  it("only workshop has an eventSubtypeWarning", () => {
    expect(EVENT_TYPE_CONFIG.rural_program.eventSubtypeWarning).toBeUndefined()
    expect(EVENT_TYPE_CONFIG.workshop.eventSubtypeWarning).toBeTruthy()
  })

  it("faculty-rows field defs are capped 1-20 and shared between both types (same object reference or deep-equal shape)", () => {
    for (const id of ["rural_program", "workshop"] as const) {
      const facultyField = EVENT_TYPE_CONFIG[id].typeSpecificFields.find((f) => f.kind === "faculty-rows")
      expect(facultyField).toMatchObject({ kind: "faculty-rows", minRows: 1, maxRows: 20 })
    }
  })

  it("association-rows field defs are capped at 10 for both types", () => {
    for (const id of ["rural_program", "workshop"] as const) {
      const assocField = EVENT_TYPE_CONFIG[id].typeSpecificFields.find((f) => f.kind === "association-rows")
      expect(assocField).toMatchObject({ kind: "association-rows", maxRows: 10 })
    }
  })

  it("the other 7 event types have no typeSpecificFields/mouClauses/agreements (unchanged shape)", () => {
    const untouchedIds = ["fmas", "mmas", "dmas", "slcp", "nextgen", "meet_the_master", "zonal_event"] as const
    for (const id of untouchedIds) {
      const config = EVENT_TYPE_CONFIG[id]
      expect(config.typeSpecificFields).toBeUndefined()
      expect(config.mouClauses).toBeUndefined()
      expect(config.agreements).toBeUndefined()
    }
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run __tests__/mou-event-type-config.test.ts`
Expected: FAIL — `MouEventTypeConfig`/`typeSpecificFields` don't exist on the config yet.

- [ ] **Step 6: Add the types to `src/lib/mou/event-type-config.ts`**

Add above `EventTypeUiConfig` (keep `EventTypeUiConfig` itself — the other 7 types still use it as their plain shape; `MouEventTypeConfig` extends it):

```typescript
export interface Agreement {
  clauseRef: string
  text: string
}

export type TypeSpecificFieldDef =
  | { key: string; kind: "text" | "textarea" | "number"; label: string; required?: boolean; maxLength?: number; min?: number; max?: number; helperText?: string }
  | { key: string; kind: "checkbox"; label: string; helperText?: string }
  | { key: string; kind: "radio"; label: string; options: { value: string; label: string }[]; required?: boolean; blockValue?: { value: string; message: string }; helperText?: string }
  | { key: "faculty"; kind: "faculty-rows"; minRows: number; maxRows: number }
  | { key: "partner_associations"; kind: "association-rows"; maxRows: number }
  | { key: string; kind: "conditional-upload"; docType: string; label: string; requiredWhen: { field: string; equals: string } }
  | { key: "facilities"; kind: "facilities-group"; items: { key: string; kind: "checkbox" | "number"; label: string }[] }

export interface MouEventTypeConfig extends EventTypeUiConfig {
  mouClauses: string[]
  mouTitle: string
  mouVersion: number
  organizerNameLabel?: string
  agreements: Agreement[]
  minLeadDays?: number
  requiresVenue?: boolean
  confirmationNote?: string
  typeSpecificFields: TypeSpecificFieldDef[]
  smallStateException?: {
    chapterFlagField: string
    venueStateField: string
    states: string[]
  }
  eventSubtypeWarning?: string
}
```

Add the import at the top of the file:

```typescript
import { RURAL_PROGRAM_CLAUSES, WORKSHOP_CLAUSES } from "./mou-pdf"
import { SMALL_STATE_CHAPTER_STATES } from "./small-state-chapters"
```

- [ ] **Step 7: Rewrite the `rural_program` entry**

Replace the current `rural_program` entry in `EVENT_TYPE_CONFIG` with (note: `EVENT_TYPE_CONFIG`'s value type is `Record<ApplicationTypeId, EventTypeUiConfig>` — widen it to `Record<ApplicationTypeId, EventTypeUiConfig | MouEventTypeConfig>` since `MouEventTypeConfig extends EventTypeUiConfig`, this is a safe widening, not a breaking change for the other 7 entries):

```typescript
  rural_program: {
    id: "rural_program", label: "Rural Surgery Camp", description: "Rural Surgery Camp hosting application",
    fields: ["amasi_membership_number", "committee_member_photo", "institution_photo", "zone"],
    mouClauses: RURAL_PROGRAM_CLAUSES,
    mouTitle: "MEMORANDUM OF UNDERSTANDING FOR RURAL SURGERY CAMP",
    mouVersion: 1,
    organizerNameLabel: "Organizing Secretary name",
    minLeadDays: 45,
    requiresVenue: true,
    confirmationNote: "AMASI HQ completes processing within two weeks of receiving the request. Please do not announce or publicise the programme until you receive written approval.",
    agreements: [
      { clauseRef: "4", text: "I confirm the camp will be held in a hospital in a rural setting, not in an urban area." },
      { clauseRef: "5, 6", text: "I will not announce or publicise the programme, or use the AMASI name or logo in any form, until written approval is received from AMASI HQ." },
      { clauseRef: "7", text: "All banners, brochures, print and electronic materials will carry the logos of both AMASI and ASI." },
      { clauseRef: "12", text: "No bank account will be opened in the name of AMASI for this camp under any circumstances." },
      { clauseRef: "19", text: "The organising committee bears full financial responsibility for the camp; AMASI bears no financial liability." },
      { clauseRef: "20", text: "I understand AMASI provides financial assistance up to ₹1,00,000 only, released against original bills and vouchers." },
      { clauseRef: "16", text: "The organising committee will arrange to-and-fro transport for AMASI-provided faculty from the nearest railhead or airport, and their accommodation and food." },
      { clauseRef: "17", text: "No audiovisual material promoting the meetings, conferences or workshops of any other professional body will be displayed at the venue without informing AMASI." },
      { clauseRef: "18", text: "The camp will not be used for personal propaganda, promotion of a private hospital, political propaganda, or any purpose other than service to the population." },
      { clauseRef: "21, 22", text: "I will forward the detailed programme, the list of organising committee members, and the schedule of lectures and operations at least 3 weeks before the camp." },
      { clauseRef: "23", text: "I will provide full details of the available facilities to the Hon. Secretary at least one month in advance." },
      { clauseRef: "24", text: "I will submit a report to the Hon. Secretary within 15 days of the camp, including photographs, location, a description of the beneficiaries, and the total number of surgeries performed." },
      { clauseRef: "25", text: "I understand that my OTP-verified acceptance of the MOU on this form is my signature on it as Organizing Secretary, and that the MOU takes effect once AMASI approves this application." },
      { clauseRef: "existing", text: "I certify that all information provided is accurate and that I have the authority to submit this application on behalf of my institution." },
    ],
    typeSpecificFields: [
      { key: "amasi_year_of_joining", kind: "number", label: "Year of joining AMASI", min: 1993, max: new Date().getFullYear() },
      { key: "designation", kind: "text", label: "Designation at institution" },
      { key: "venue_setting", kind: "radio", label: "Setting", required: true, options: [
        { value: "Rural", label: "Rural" }, { value: "Semi-urban", label: "Semi-urban" }, { value: "Urban", label: "Urban" },
      ], blockValue: { value: "Urban", message: "Clause 4 of the MOU requires the camp to be held in a hospital in a rural setting. Urban venues cannot be accepted." } },
      { key: "institution_type", kind: "radio", label: "Institution type", required: true, options: [
        { value: "own", label: "Own institution" }, { value: "guest", label: "Guest institution" }, { value: "private", label: "Private institution (individual)" },
      ] },
      { key: "joint_programme", kind: "checkbox", label: "This is a joint programme with another association", helperText: "Add a consent letter for each partner association below." },
      { key: "consent_guest_institution", kind: "conditional-upload", docType: "consent_guest_institution", label: "Consent letter from Head of the guest institution", requiredWhen: { field: "institution_type", equals: "guest" } },
      { key: "brief_institution", kind: "conditional-upload", docType: "brief_institution", label: "Brief about the institution", requiredWhen: { field: "institution_type", equals: "private" } },
      { key: "partner_associations", kind: "association-rows", maxRows: 10 },
      { key: "expected_beneficiaries", kind: "number", label: "Expected number of beneficiaries" },
      { key: "target_population", kind: "textarea", label: "Target population / catchment description", maxLength: 500 },
      { key: "expected_surgeries", kind: "number", label: "Expected number of surgeries" },
      { key: "proposed_registration_fee", kind: "number", label: "Proposed registration fee (₹)", helperText: "Subject to AMASI approval." },
      { key: "programme_outline", kind: "textarea", label: "Proposed programme outline", helperText: "Final programme only after AMASI approval." },
      { key: "financial_assistance_requested", kind: "checkbox", label: "Requesting AMASI financial assistance (up to ₹1,00,000)" },
      { key: "nearest_airport", kind: "text", label: "Nearest airport" },
      { key: "nearest_airport_km", kind: "number", label: "Distance to nearest airport (km)" },
      { key: "nearest_railhead", kind: "text", label: "Nearest railhead" },
      { key: "nearest_railhead_km", kind: "number", label: "Distance to nearest railhead (km)" },
      { key: "facilities", kind: "facilities-group", items: [
        { key: "hall_a", kind: "checkbox", label: "Hall A" },
        { key: "hall_b", kind: "checkbox", label: "Hall B" },
        { key: "av_equipment", kind: "checkbox", label: "AV equipment" },
        { key: "endotrainers", kind: "checkbox", label: "Endotrainers" },
        { key: "operation_theatres", kind: "number", label: "Operation theatres" },
        { key: "ot_tables", kind: "number", label: "OT tables" },
        { key: "anaesthesia_support", kind: "checkbox", label: "Anaesthesia support" },
        { key: "sterilisation_facility", kind: "checkbox", label: "Sterilisation facility" },
        { key: "inpatient_beds", kind: "number", label: "Inpatient beds" },
      ] },
      { key: "faculty", kind: "faculty-rows", minRows: 1, maxRows: 20 },
    ],
  },
```

- [ ] **Step 8: Rewrite the `workshop` entry**

```typescript
  workshop: {
    id: "workshop", label: "Workshop / CME / Conference", description: "AMASI workshop, CME, or conference hosting application (other than AMASICON)",
    fields: ["event_name", "expected_participants", "live_surgery_demo", "zone"],
    mouClauses: WORKSHOP_CLAUSES,
    mouTitle: "MEMORANDUM OF UNDERSTANDING FOR WORKSHOP/CME/CONFERENCE (OTHER THAN AMASICON)",
    mouVersion: 1,
    organizerNameLabel: "Organizing Secretary name",
    minLeadDays: 45,
    requiresVenue: true,
    confirmationNote: "AMASI HQ completes processing within two weeks of receiving the request. Please do not announce or publicise the programme until you receive written approval.",
    eventSubtypeWarning: "The MOU covers events other than AMASICON. Annual conference applications do not go through this route.",
    smallStateException: {
      chapterFlagField: "organised_by_state_chapter",
      venueStateField: "venue_state",
      states: SMALL_STATE_CHAPTER_STATES,
    },
    agreements: [
      { clauseRef: "5, 7", text: "I will not announce or publicise the programme, or use the AMASI name or logo in any form, until written approval is received from AMASI HQ." },
      { clauseRef: "6", text: "All banners, brochures, print and electronic materials will carry the logos of both AMASI and ASI." },
      { clauseRef: "12", text: "No bank account will be opened in the name of AMASI for this event under any circumstances." },
      { clauseRef: "13", text: "The programme — speakers, subjects, timings, allotment of halls and chairpersons — will be finalised only after AMASI's approval." },
      { clauseRef: "13", text: "The organising committee will provide halls of adequate capacity, audiovisual equipment and its management, a suitable podium, and personnel for assistance." },
      { clauseRef: "16", text: "The organising committee will arrange to-and-fro transport, accommodation and food for AMASI-provided faculty." },
      { clauseRef: "18", text: "No audiovisual material promoting the meetings, conferences or workshops of any other professional body will be displayed at the venue without informing AMASI." },
      { clauseRef: "19", text: "The event will not be used for personal propaganda, promotion of a private hospital, political propaganda, or any purpose other than the academic dissemination of knowledge." },
      { clauseRef: "20", text: "The organising committee bears full financial responsibility for the event; AMASI bears no financial liability, and no payment is due to AMASI." },
      { clauseRef: "21, 22", text: "I will forward the detailed programme, the list of organising committee members, the schedule of lectures, and the faculty involved at least 3 weeks before the event." },
      { clauseRef: "24", text: "I will provide full details of the available facilities to the Hon. Secretary at least one month in advance, and I accept that full responsibility for conducting the event rests with the organising committee." },
      { clauseRef: "25", text: "I will submit a report with photographs to the Hon. Secretary within 15 days of the event." },
      { clauseRef: "26", text: "I understand that my OTP-verified acceptance of the MOU on this form is my signature on it as Organizing Secretary, and that the MOU takes effect once AMASI approves this application." },
      { clauseRef: "existing", text: "I certify that all information provided is accurate and that I have the authority to submit this application on behalf of my institution." },
    ],
    typeSpecificFields: [
      { key: "amasi_year_of_joining", kind: "number", label: "Year of joining AMASI", min: 1993, max: new Date().getFullYear() },
      { key: "designation", kind: "text", label: "Designation at institution" },
      { key: "event_subtype", kind: "radio", label: "Event type", required: true, options: [
        { value: "workshop", label: "Workshop" }, { value: "cme", label: "CME" }, { value: "conference", label: "Conference" },
      ] },
      { key: "institution_type", kind: "radio", label: "Institution type", required: true, options: [
        { value: "own", label: "Own institution" }, { value: "guest", label: "Guest institution" }, { value: "private", label: "Private institution (individual)" },
      ] },
      { key: "joint_programme", kind: "checkbox", label: "This is a joint programme with another association", helperText: "Add a consent letter for each partner association below." },
      { key: "consent_guest_institution", kind: "conditional-upload", docType: "consent_guest_institution", label: "Consent letter from Head of the guest institution", requiredWhen: { field: "institution_type", equals: "guest" } },
      { key: "brief_institution", kind: "conditional-upload", docType: "brief_institution", label: "Brief about the institution", requiredWhen: { field: "institution_type", equals: "private" } },
      { key: "partner_associations", kind: "association-rows", maxRows: 10 },
      { key: "expected_delegates", kind: "number", label: "Expected number of delegates" },
      { key: "proposed_registration_fee", kind: "number", label: "Proposed registration fee (₹)", helperText: "Subject to AMASI approval." },
      { key: "programme_outline", kind: "textarea", label: "Proposed programme outline", helperText: "Final programme only after AMASI approval." },
      { key: "faculty_travel_mode", kind: "radio", label: "How will AMASI faculty travel be arranged?", required: true, options: [
        { value: "reimburse", label: "Faculty book their own travel; organiser reimburses at the venue" },
        { value: "direct_booking", label: "Organiser books airline/train tickets directly, on a mutually suitable itinerary" },
      ], helperText: "Both modes leave accommodation and food with the organiser." },
      { key: "organised_by_state_chapter", kind: "checkbox", label: "Is this event organised by a state chapter?" },
      { key: "small_state_exception_requested", kind: "checkbox", label: "Request AMASI-funded faculty transport under clause 17", helperText: "AMASI will provide to-and-fro transport for 2–3 faculty. Local hospitality, accommodation and food for these faculty remain the organiser's responsibility." },
      { key: "small_state_faculty_count", kind: "number", label: "Number of faculty (2 or 3 only)", min: 2, max: 3 },
      { key: "email_circular_requested", kind: "checkbox", label: "Request an AMASI email circular to members announcing this event", helperText: "AMASI will send it only if the facility is available and the organiser submits event details in the prescribed format at least 3 weeks before the event." },
      { key: "facilities", kind: "facilities-group", items: [
        { key: "halls", kind: "number", label: "Number of halls" },
        { key: "seating_capacity", kind: "number", label: "Total seating capacity" },
        { key: "av_equipment", kind: "checkbox", label: "AV equipment" },
        { key: "av_management", kind: "checkbox", label: "AV technician/management provided" },
        { key: "podium", kind: "checkbox", label: "Podium" },
        { key: "personnel", kind: "checkbox", label: "Support personnel" },
      ] },
      { key: "faculty", kind: "faculty-rows", minRows: 1, maxRows: 20 },
    ],
  },
```

- [ ] **Step 9: Update the `EVENT_TYPE_CONFIG` record type to accept both shapes**

Change:
```typescript
export const EVENT_TYPE_CONFIG: Record<ApplicationTypeId, EventTypeUiConfig> = {
```
to:
```typescript
export const EVENT_TYPE_CONFIG: Record<ApplicationTypeId, EventTypeUiConfig | MouEventTypeConfig> = {
```

And update `getEventTypeConfig`'s return type the same way:
```typescript
export function getEventTypeConfig(id: string): (EventTypeUiConfig | MouEventTypeConfig) | null {
  return (EVENT_TYPE_CONFIG as Record<string, EventTypeUiConfig | MouEventTypeConfig>)[id] ?? null
}
```

Add a small type-guard helper other tasks will use to narrow the union without repeating `"typeSpecificFields" in config` everywhere:

```typescript
export function isMouEventTypeConfig(config: EventTypeUiConfig | MouEventTypeConfig): config is MouEventTypeConfig {
  return "typeSpecificFields" in config
}
```

**Plan-review ruling (added before implementation, not part of the original draft):** `typeSpecificFields` keys split into two groups — some ALSO have a real column from Task 1's migration (`amasi_year_of_joining`, `designation`, `institution_type`, `joint_programme`, `proposed_registration_fee`, `programme_outline` — plus `faculty`/`partner_associations`/the two `conditional-upload` `_url` fields, which are handled separately since their key already equals the column name). Everything else in `typeSpecificFields` (rural's `venue_setting`/`expected_beneficiaries`/`target_population`/`expected_surgeries`/`financial_assistance_requested`/`nearest_airport*`/`facilities`; workshop's `event_subtype`/`expected_delegates`/`faculty_travel_mode`/`organised_by_state_chapter`/`small_state_exception_requested`/`small_state_faculty_count`/`email_circular_requested`/`facilities`) has NO column of its own — Task 1's `type_specific_data` column is where those live, per Task 1's own column comment. Task 5 and Task 10 both need to know which bucket a key falls in; rather than hardcode that set twice (drift risk), export it once here:

```typescript
// Keys in a MouEventTypeConfig's typeSpecificFields that ALSO have a real
// column on academic_event_applications (from sql/040) — everything else
// in typeSpecificFields belongs only in type_specific_data. Single source
// of truth for Task 5 (route.ts, writing) and Task 10 (admin page,
// reading) so the two never drift apart on which bucket a key is in.
export const SHARED_TYPE_SPECIFIC_COLUMN_KEYS = new Set([
  "amasi_year_of_joining", "designation", "institution_type", "joint_programme",
  "proposed_registration_fee", "programme_outline",
])
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run __tests__/mou-event-type-config.test.ts`
Expected: PASS (13 tests — the original 4 plus the 9 new ones)

- [ ] **Step 11: Run full type-check**

Run: `npx tsc --noEmit`
Expected: PASS. If a downstream file (e.g. `application-form.tsx`, `admin/mou-applications/page.tsx`) errors because it destructures a field only present on the narrower `EventTypeUiConfig` type after the union widening, that's expected until Tasks 5/8/10 update those call sites — note it in your task report but do not fix files outside this task's scope.

- [ ] **Step 12: Commit**

```bash
git add src/lib/mou/mou-pdf.tsx src/lib/mou/event-type-config.ts src/lib/mou/small-state-chapters.ts __tests__/mou-event-type-config.test.ts
git commit -m "feat(mou): add MouEventTypeConfig, small-state list, rural+workshop config data"
```

---

### Task 4: `validateTypeSpecificFields` — shared server-side validator

**Files:**
- Create: `src/lib/mou/type-specific-validation.ts`
- Test: `__tests__/mou-type-specific-validation.test.ts`

**Interfaces:**
- Consumes: `MouEventTypeConfig`, `TypeSpecificFieldDef` (Task 3).
- Produces: `validateTypeSpecificFields(config: MouEventTypeConfig, body: Record<string, unknown>): string | null` (returns the first failing rule's message, or `null` if valid) — consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/mou-type-specific-validation.test.ts
import { describe, it, expect } from "vitest"
import { validateTypeSpecificFields } from "@/lib/mou/type-specific-validation"
import { EVENT_TYPE_CONFIG, isMouEventTypeConfig } from "@/lib/mou/event-type-config"

const rural = EVENT_TYPE_CONFIG.rural_program
const workshop = EVENT_TYPE_CONFIG.workshop
if (!isMouEventTypeConfig(rural) || !isMouEventTypeConfig(workshop)) {
  throw new Error("rural_program/workshop must be MouEventTypeConfig — check Task 3 landed first")
}

function futureDate(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().slice(0, 10)
}

const validRuralBody = {
  preferred_date_1: futureDate(60),
  applicant_amasi_number: "12345",
  venue_type: "Hospital", venue_name: "X", venue_address: "Y", venue_city: "Z", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India",
  venue_setting: "Rural",
  institution_type: "own",
  joint_programme: false,
  faculty: [{ name: "Dr. A", amasi_membership_number: "123", speciality: null, is_amasi_member: true }],
  agreements: Object.fromEntries(rural.agreements.map((a) => [a.clauseRef, new Date().toISOString()])),
}

describe("validateTypeSpecificFields — rural_program", () => {
  it("passes a fully valid body", () => {
    expect(validateTypeSpecificFields(rural, validRuralBody)).toBeNull()
  })

  it("requires applicant_amasi_number (optional for fmas/mmas/dmas/slcp, required here)", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, applicant_amasi_number: undefined })
    expect(result).toContain("AMASI membership number")
  })

  it("blocks Urban venue setting with the clause-4 message", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, venue_setting: "Urban" })
    expect(result).toContain("Clause 4")
    expect(result).toContain("rural setting")
  })

  it("rejects a preferred_date_1 less than 45 days out", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, preferred_date_1: futureDate(10) })
    expect(result).toContain("45 days")
  })

  it("requires venue fields (requiresVenue: true)", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, venue_name: undefined })
    expect(result).toBeTruthy()
  })

  it("requires at least 1 faculty row", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, faculty: [] })
    expect(result).toBeTruthy()
  })

  it("rejects more than 20 faculty rows", () => {
    const faculty = Array.from({ length: 21 }, (_, i) => ({ name: `Dr. ${i}`, amasi_membership_number: null, speciality: null, is_amasi_member: true }))
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, faculty })
    expect(result).toBeTruthy()
  })

  it("requires speciality for a non-AMASI-member faculty row", () => {
    const faculty = [{ name: "Dr. Guest", amasi_membership_number: null, speciality: null, is_amasi_member: false }]
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, faculty })
    expect(result).toContain("speciality")
  })

  it("rejects more than 10 partner associations", () => {
    const partner_associations = Array.from({ length: 11 }, (_, i) => ({ name: `Assoc ${i}`, consent_letter_url: "https://x/y.pdf" }))
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, joint_programme: true, partner_associations })
    expect(result).toBeTruthy()
  })

  it("requires at least 1 partner association when joint_programme is true", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, joint_programme: true, partner_associations: [] })
    expect(result).toBeTruthy()
  })

  it("requires the guest-institution consent upload when institution_type is guest", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, institution_type: "guest", consent_guest_institution_url: undefined })
    expect(result).toBeTruthy()
  })

  it("passes when institution_type is guest and the consent upload is present", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, institution_type: "guest", consent_guest_institution_url: "https://x/consent.pdf" })
    expect(result).toBeNull()
  })

  it("requires the private-institution brief upload when institution_type is private", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, institution_type: "private", brief_institution_url: undefined })
    expect(result).toBeTruthy()
  })

  it("rejects target_population longer than 500 characters", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, target_population: "x".repeat(501) })
    expect(result).toBeTruthy()
  })

  it("rejects when not every agreement clauseRef is present and truthy", () => {
    const { [rural.agreements[0].clauseRef]: _omit, ...incomplete } = validRuralBody.agreements
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, agreements: incomplete })
    expect(result).toBeTruthy()
  })
})

const validWorkshopBody = {
  preferred_date_1: futureDate(60),
  applicant_amasi_number: "12345",
  venue_type: "Hotel", venue_name: "X", venue_address: "Y", venue_city: "Z", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India",
  event_subtype: "workshop",
  institution_type: "own",
  joint_programme: false,
  faculty_travel_mode: "reimburse",
  organised_by_state_chapter: false,
  small_state_exception_requested: false,
  faculty: [{ name: "Dr. A", amasi_membership_number: "123", speciality: null, is_amasi_member: true }],
  agreements: Object.fromEntries(workshop.agreements.map((a) => [a.clauseRef, new Date().toISOString()])),
}

describe("validateTypeSpecificFields — workshop", () => {
  it("passes a fully valid body", () => {
    expect(validateTypeSpecificFields(workshop, validWorkshopBody)).toBeNull()
  })

  it("has no venue_setting field at all (not copied from rural)", () => {
    expect(workshop.typeSpecificFields.some((f) => f.key === "venue_setting")).toBe(false)
  })

  it("requires event_subtype", () => {
    const result = validateTypeSpecificFields(workshop, { ...validWorkshopBody, event_subtype: undefined })
    expect(result).toBeTruthy()
  })

  it("requires faculty_travel_mode", () => {
    const result = validateTypeSpecificFields(workshop, { ...validWorkshopBody, faculty_travel_mode: undefined })
    expect(result).toBeTruthy()
  })

  it("rejects the small-state exception when organised_by_state_chapter is false", () => {
    const result = validateTypeSpecificFields(workshop, {
      ...validWorkshopBody, small_state_exception_requested: true, organised_by_state_chapter: false,
      venue_state: "Sikkim", small_state_faculty_count: 2,
    })
    expect(result).toContain("clause 17")
  })

  it("rejects the small-state exception when venue_state is not in the eligible list", () => {
    const result = validateTypeSpecificFields(workshop, {
      ...validWorkshopBody, small_state_exception_requested: true, organised_by_state_chapter: true,
      venue_state: "Tamil Nadu", small_state_faculty_count: 2,
    })
    expect(result).toContain("clause 17")
  })

  it("rejects a small_state_faculty_count outside [2, 3]", () => {
    const result = validateTypeSpecificFields(workshop, {
      ...validWorkshopBody, small_state_exception_requested: true, organised_by_state_chapter: true,
      venue_state: "Sikkim", small_state_faculty_count: 4,
    })
    expect(result).toContain("clause 17")
  })

  it("accepts a valid small-state exception request", () => {
    const result = validateTypeSpecificFields(workshop, {
      ...validWorkshopBody, small_state_exception_requested: true, organised_by_state_chapter: true,
      venue_state: "Sikkim", small_state_faculty_count: 3,
    })
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/mou-type-specific-validation.test.ts`
Expected: FAIL — `src/lib/mou/type-specific-validation.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/mou/type-specific-validation.ts
import type { MouEventTypeConfig, TypeSpecificFieldDef } from "./event-type-config"

type Body = Record<string, unknown>

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === ""
}

function validateField(field: TypeSpecificFieldDef, body: Body): string | null {
  switch (field.kind) {
    case "text":
    case "textarea":
    case "number": {
      const value = body[field.key]
      if (field.required && isBlank(value)) return `${field.label} is required`
      if (typeof value === "string" && field.kind === "textarea" && field.maxLength && value.length > field.maxLength) {
        return `${field.label} must be ${field.maxLength} characters or fewer`
      }
      if (field.kind === "number" && !isBlank(value)) {
        const n = Number(value)
        if (Number.isNaN(n)) return `${field.label} must be a number`
        if (field.min !== undefined && n < field.min) return `${field.label} must be at least ${field.min}`
        if (field.max !== undefined && n > field.max) return `${field.label} must be at most ${field.max}`
      }
      return null
    }
    case "radio": {
      const value = body[field.key]
      if (field.required && isBlank(value)) return `${field.label} is required`
      if (field.blockValue && value === field.blockValue.value) return field.blockValue.message
      return null
    }
    case "checkbox":
      return null
    case "faculty-rows": {
      const rows = Array.isArray(body.faculty) ? (body.faculty as Array<{ is_amasi_member?: boolean; speciality?: string | null }>) : []
      if (rows.length < field.minRows) return `At least ${field.minRows} faculty member${field.minRows === 1 ? "" : "s"} required`
      if (rows.length > field.maxRows) return `At most ${field.maxRows} faculty members allowed`
      for (const row of rows) {
        if (row.is_amasi_member === false && isBlank(row.speciality)) {
          return "Non-AMASI faculty members must have a speciality — non-member faculty are permitted only for other specialities (anaesthesia, gynaecology, urology, gastroenterology, etc.) and require prior intimation to AMASI"
        }
      }
      return null
    }
    case "association-rows": {
      const rows = Array.isArray(body.partner_associations) ? body.partner_associations : []
      if (rows.length > field.maxRows) return `At most ${field.maxRows} partner associations allowed`
      if (body.joint_programme === true && rows.length < 1) return "At least one partner association is required for a joint programme"
      return null
    }
    case "conditional-upload": {
      const conditionMet = body[field.requiredWhen.field] === field.requiredWhen.equals
      if (conditionMet && isBlank(body[`${field.docType}_url`])) return `${field.label} is required`
      return null
    }
    case "facilities-group":
      return null
  }
}

export function validateTypeSpecificFields(config: MouEventTypeConfig, body: Body): string | null {
  // Both rural_program and workshop require AMASI membership number (rural
  // spec §1: "Make required"; workshop spec §1 reuses this as-is) — every
  // OTHER type with "amasi_membership_number" in its common `fields` list
  // (fmas/mmas/dmas/slcp) leaves it optional, so this can't be a change to
  // the shared route.ts REQUIRED_FIELDS constant. Every MouEventTypeConfig
  // consumer currently has this field in `fields`, but check defensively
  // rather than assume, since a future type could theoretically omit it.
  if (config.fields.includes("amasi_membership_number") && isBlank(body.applicant_amasi_number)) {
    return "AMASI membership number is required"
  }

  if (config.requiresVenue) {
    const venueFields: [string, string][] = [
      ["venue_type", "Venue type"], ["venue_name", "Venue name"], ["venue_address", "Address"],
      ["venue_city", "City"], ["venue_state", "State"], ["venue_zip", "Postal code"],
    ]
    for (const [key, label] of venueFields) {
      if (isBlank(body[key])) return `${label} is required`
    }
  }

  if (config.minLeadDays) {
    const minDate = new Date()
    minDate.setDate(minDate.getDate() + config.minLeadDays)
    minDate.setHours(0, 0, 0, 0)
    for (const dateKey of ["preferred_date_1", "preferred_date_2"] as const) {
      const raw = body[dateKey]
      if (typeof raw !== "string" || !raw) continue
      const d = new Date(raw)
      if (d < minDate) {
        return `AMASI requires facility details one month in advance and the signed MOU 15 days before the event. Please choose a date at least ${config.minLeadDays} days away.`
      }
    }
  }

  for (const field of config.typeSpecificFields) {
    const message = validateField(field, body)
    if (message) return message
  }

  const agreements = (body.agreements ?? {}) as Record<string, unknown>
  for (const a of config.agreements) {
    if (!agreements[a.clauseRef]) return `Please accept all agreements before submitting (missing: clause ${a.clauseRef})`
  }

  if (body.small_state_exception_requested === true && config.smallStateException) {
    const { chapterFlagField, venueStateField, states } = config.smallStateException
    const chapterOk = body[chapterFlagField] === true
    const venueState = body[venueStateField]
    const stateOk = typeof venueState === "string" && states.includes(venueState)
    const countRaw = body.small_state_faculty_count
    const count = typeof countRaw === "number" ? countRaw : Number(countRaw)
    const countOk = count === 2 || count === 3
    if (!chapterOk || !stateOk || !countOk) {
      return "Requesting AMASI-funded faculty transport under clause 17 requires the event to be organised by a state chapter, the venue to be in an eligible small state, and the faculty count to be 2 or 3."
    }
  }

  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/mou-type-specific-validation.test.ts`
Expected: PASS (25 tests)

- [ ] **Step 5: Run type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/mou/type-specific-validation.ts`
Expected: PASS on both

- [ ] **Step 6: Commit**

```bash
git add src/lib/mou/type-specific-validation.ts __tests__/mou-type-specific-validation.test.ts
git commit -m "feat(mou): add shared server-side type-specific field validator"
```

---

### Task 5: Wire the submission route, upload doc types, and confirmation-note email

**Files:**
- Modify: `src/app/api/mou/applications/route.ts`
- Modify: `src/app/api/mou/applications/upload/route.ts`
- Modify: `src/lib/mou/notify.ts`
- Test: `__tests__/mou-api-applications.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: `validateTypeSpecificFields` (Task 4), `computeMouHash`/`createMouSignature` (Task 2), `isMouEventTypeConfig` (Task 3).
- Produces: nothing new — this task wires existing consumers together.

- [ ] **Step 1: Extend `VALID_DOC_TYPES` in the upload route**

In `src/app/api/mou/applications/upload/route.ts`, change:
```typescript
const VALID_DOC_TYPES = new Set(["committee_member_photo", "institution_photo"])
```
to:
```typescript
const VALID_DOC_TYPES = new Set([
  "committee_member_photo", "institution_photo",
  "consent_guest_institution", "brief_institution", "consent_partner_association",
])
```
No other change to this file — the rest of the pipeline (magic-byte sniff, UUID path, 5MB cap, OTP gate, rate limit) is already type-agnostic.

- [ ] **Step 2: Write the failing tests for the submission route (append to the existing test file)**

Add these `vi.mock` extensions at the top of `__tests__/mou-api-applications.test.ts` (alongside the existing mocks):

```typescript
vi.mock("@/lib/mou/mou-signature", () => ({
  computeMouHash: vi.fn().mockReturnValue("fake-hash"),
  createMouSignature: vi.fn().mockResolvedValue({ id: "sig-1" }),
}))
```

Add these tests to the existing `describe("POST /api/mou/applications", ...)` block:

```typescript
  it("rejects a rural_program submission missing type-specific required fields", async () => {
    const req = new Request("http://test/api/mou/applications", {
      method: "POST",
      body: JSON.stringify({
        ...validBody,
        application_type_id: "rural_program",
        // no venue_*, venue_setting, institution_type, faculty, agreements — all required for this type
      }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    expect(createApplication).not.toHaveBeenCalled()
  })

  it("calls createMouSignature after a successful rural_program submission", async () => {
    const { createMouSignature } = await import("@/lib/mou/mou-signature")
    const { EVENT_TYPE_CONFIG } = await import("@/lib/mou/event-type-config")
    const rural = EVENT_TYPE_CONFIG.rural_program as import("@/lib/mou/event-type-config").MouEventTypeConfig
    const futureDate = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10) })()
    const ruralBody = {
      ...validBody,
      application_type_id: "rural_program",
      preferred_date_1: futureDate,
      applicant_amasi_number: "12345",
      venue_type: "Hospital", venue_name: "X", venue_address: "Y", venue_city: "Z", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India",
      venue_setting: "Rural",
      institution_type: "own",
      joint_programme: false,
      faculty: [{ name: "Dr. A", amasi_membership_number: "123", speciality: null, is_amasi_member: true }],
      agreements: Object.fromEntries(rural.agreements.map((a) => [a.clauseRef, new Date().toISOString()])),
    }
    const req = new Request("http://test/api/mou/applications", { method: "POST", body: JSON.stringify(ruralBody) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(createMouSignature).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: "app-1", signatoryEmail: "organizer@example.com" })
    )
  })

  it("buckets type-specific-only fields into type_specific_data, keeps shared-column fields at the top level (plan-review fix)", async () => {
    const { EVENT_TYPE_CONFIG } = await import("@/lib/mou/event-type-config")
    const rural = EVENT_TYPE_CONFIG.rural_program as import("@/lib/mou/event-type-config").MouEventTypeConfig
    const futureDate = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10) })()
    const ruralBody = {
      ...validBody, application_type_id: "rural_program", preferred_date_1: futureDate,
      applicant_amasi_number: "12345",
      venue_type: "Hospital", venue_name: "X", venue_address: "Y", venue_city: "Z", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India",
      venue_setting: "Rural", institution_type: "own", joint_programme: false,
      expected_beneficiaries: 40, financial_assistance_requested: true,
      faculty: [{ name: "Dr. A", amasi_membership_number: "123", speciality: null, is_amasi_member: true }],
      agreements: Object.fromEntries(rural.agreements.map((a) => [a.clauseRef, new Date().toISOString()])),
    }
    const req = new Request("http://test/api/mou/applications", { method: "POST", body: JSON.stringify(ruralBody) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(req as any)
    const insertedBody = vi.mocked(createApplication).mock.calls[0][0]
    // venue_setting/expected_beneficiaries/financial_assistance_requested have
    // NO column of their own — they must land in type_specific_data.
    expect(insertedBody.type_specific_data).toMatchObject({
      venue_setting: "Rural", expected_beneficiaries: 40, financial_assistance_requested: true, _v: 1,
    })
    // institution_type DOES have a real column — it must NOT be duplicated
    // inside type_specific_data.
    expect(insertedBody.institution_type).toBe("own")
    expect((insertedBody.type_specific_data as Record<string, unknown>).institution_type).toBeUndefined()
  })

  it("returns 500 (not a silent swallow) when createMouSignature fails for a mou-framework type", async () => {
    const { createMouSignature } = await import("@/lib/mou/mou-signature")
    vi.mocked(createMouSignature).mockRejectedValueOnce(new Error("insert failed"))
    const { EVENT_TYPE_CONFIG } = await import("@/lib/mou/event-type-config")
    const rural = EVENT_TYPE_CONFIG.rural_program as import("@/lib/mou/event-type-config").MouEventTypeConfig
    const futureDate = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10) })()
    const ruralBody = {
      ...validBody, application_type_id: "rural_program", preferred_date_1: futureDate,
      applicant_amasi_number: "12345",
      venue_type: "Hospital", venue_name: "X", venue_address: "Y", venue_city: "Z", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India",
      venue_setting: "Rural", institution_type: "own", joint_programme: false,
      faculty: [{ name: "Dr. A", amasi_membership_number: "123", speciality: null, is_amasi_member: true }],
      agreements: Object.fromEntries(rural.agreements.map((a) => [a.clauseRef, new Date().toISOString()])),
    }
    const req = new Request("http://test/api/mou/applications", { method: "POST", body: JSON.stringify(ruralBody) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(500)
  })

  it("does not call validateTypeSpecificFields/createMouSignature for the other 7 unchanged types (fmas)", async () => {
    const { createMouSignature } = await import("@/lib/mou/mou-signature")
    const req = new Request("http://test/api/mou/applications", { method: "POST", body: JSON.stringify(validBody) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(createMouSignature).not.toHaveBeenCalled()
  })
```

- [ ] **Step 3: Run tests to verify the new ones fail**

Run: `npx vitest run __tests__/mou-api-applications.test.ts`
Expected: FAIL on the 4 new tests (route doesn't call the validator/signature functions, and doesn't bucket type_specific_data, yet).

- [ ] **Step 4: Wire `src/app/api/mou/applications/route.ts`**

Add imports:
```typescript
import { isMouEventTypeConfig, SHARED_TYPE_SPECIFIC_COLUMN_KEYS } from "@/lib/mou/event-type-config"
import { validateTypeSpecificFields } from "@/lib/mou/type-specific-validation"
import { computeMouHash, createMouSignature } from "@/lib/mou/mou-signature"
```

Extend `pickApplicationInput` to also pass through the new shared columns (add to the returned object). Note `type_specific_data` is deliberately NOT one of these — the client sends every type-specific field flat (matching `typeSpecificValues`' shape from Task 8), never a pre-bundled nested object, so `type_specific_data` is assembled server-side below, not picked from `raw`:
```typescript
    amasi_year_of_joining: raw.amasi_year_of_joining,
    designation: raw.designation,
    proposed_registration_fee: raw.proposed_registration_fee,
    programme_outline: raw.programme_outline,
    institution_type: raw.institution_type,
    joint_programme: raw.joint_programme,
    partner_associations: raw.partner_associations,
    consent_guest_institution_url: raw.consent_guest_institution_url,
    brief_institution_url: raw.brief_institution_url,
    faculty: raw.faculty,
    agreements: raw.agreements,
```

After the existing `if (typeConfig.fields.includes("zone") && !body.zone) { ... }` block and before the OTP check, add:

```typescript
  if (isMouEventTypeConfig(typeConfig)) {
    const validationError = validateTypeSpecificFields(typeConfig, rawBody)
    if (validationError) return Response.json({ status: false, message: validationError }, { status: 400 })
  }
```

Right after that block (still before the OTP check — `type_specific_data` must be on `body` before `createApplication(body)` runs), assemble `type_specific_data` from every `typeSpecificFields` key that has NO real column of its own (everything not in `SHARED_TYPE_SPECIFIC_COLUMN_KEYS` and not a `faculty-rows`/`association-rows`/`conditional-upload` field, which are already carried through by the `pickApplicationInput` list above):

```typescript
  if (isMouEventTypeConfig(typeConfig)) {
    const typeSpecificData: Record<string, unknown> = { _v: 1 }
    for (const field of typeConfig.typeSpecificFields) {
      if (field.kind === "faculty-rows" || field.kind === "association-rows" || field.kind === "conditional-upload") continue
      if (SHARED_TYPE_SPECIFIC_COLUMN_KEYS.has(field.key)) continue
      typeSpecificData[field.key] = rawBody[field.key]
    }
    body.type_specific_data = typeSpecificData
  }
```

After `const application = await createApplication(body)` and before the `try { await sendApplicantConfirmation(application) }` block, add (this one is NOT wrapped in a swallow-and-continue try/catch — per the design spec's resolved decision #3, a failed signature insert must 500 the applicant, unlike the notification steps below it):

```typescript
  if (isMouEventTypeConfig(typeConfig)) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const userAgent = request.headers.get("user-agent")
    try {
      await createMouSignature({
        applicationId: application.id,
        mouVersion: typeConfig.mouVersion,
        mouSha256: computeMouHash(typeConfig.mouClauses, typeConfig.mouVersion),
        signatoryName: application.organizer_name,
        signatoryEmail: application.email,
        signatoryAmasiNumber: application.applicant_amasi_number,
        otpVerifiedAt: application.otp_verified_at ?? new Date().toISOString(),
        ipAddress: ip,
        userAgent,
      })
    } catch (err) {
      console.error(`[mou-applications] signature record failed for application ${application.id}:`, err)
      Sentry.captureException(err, {
        tags: { component: "mou-applications", op: "create-mou-signature" },
        extra: { applicationId: application.id },
      })
      return Response.json(
        { status: false, message: "Your application could not be recorded. Please try submitting again." },
        { status: 500 }
      )
    }
  }
```

Finally, wire `confirmationNote` into the applicant email — change:
```typescript
  try {
    await sendApplicantConfirmation(application)
  } catch (err) {
```
to:
```typescript
  try {
    await sendApplicantConfirmation(application, isMouEventTypeConfig(typeConfig) ? typeConfig.confirmationNote : undefined)
  } catch (err) {
```

- [ ] **Step 5: Add the optional `confirmationNote` param to `sendApplicantConfirmation`**

In `src/lib/mou/notify.ts`, change the signature and body:
```typescript
export async function sendApplicantConfirmation(application: AcademicEventApplication, confirmationNote?: string): Promise<void> {
  const organizerName = escapeHtml(application.organizer_name)
  const noteHtml = confirmationNote ? `<p>${escapeHtml(confirmationNote)}</p>` : ""
  await getResend().emails.send({
    from: FROM,
    to: application.email,
    subject: "AMASI application received",
    html: `<p>Dear ${organizerName},</p>
      <p>Your application (ID ${application.id}) has been received and is under review by the AMASI Hon. Secretary.
      You'll be notified by email once a decision is made.</p>
      ${noteHtml}
      <p>You can check the status of your application at any time here:
      <a href="${statusLinkUrl(application)}">${statusLinkUrl(application)}</a></p>`,
  })
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run __tests__/mou-api-applications.test.ts`
Expected: PASS (all tests, including the 4 new ones and the original ones from before this task)

- [ ] **Step 7: Run full type-check, lint, and the whole suite**

Run: `npx tsc --noEmit && npx eslint src/app/api/mou/applications/route.ts src/app/api/mou/applications/upload/route.ts src/lib/mou/notify.ts && npx vitest run`
Expected: all PASS

- [ ] **Step 8: Commit**

```bash
git add src/app/api/mou/applications/route.ts src/app/api/mou/applications/upload/route.ts src/lib/mou/notify.ts __tests__/mou-api-applications.test.ts
git commit -m "feat(mou): wire submission route to type-specific validation + signature record"
```

---

### Task 6: `mou-scroll-panel.tsx` — scroll-gated MOU acceptance

**Files:**
- Create: `src/components/mou/mou-scroll-panel.tsx`
- Test: `__tests__/mou-scroll-detection.test.ts`

**Interfaces:**
- Produces: `isScrolledToEnd(el: { scrollTop: number; scrollHeight: number; clientHeight: number }, thresholdPx?: number): boolean` (pure, tested); `<MouScrollPanel clauses={string[]} title={string} scrolledToEnd={boolean} onScrolledToEnd={() => void}>` (component, wires the pure function to a real `<div>`'s `onScroll`, untested directly per this codebase's no-component-testing convention — see Global Constraints).

- [ ] **Step 1: Write the failing test for the pure scroll-detection function**

```typescript
// __tests__/mou-scroll-detection.test.ts
import { describe, it, expect } from "vitest"
import { isScrolledToEnd } from "@/components/mou/mou-scroll-panel"

describe("isScrolledToEnd", () => {
  it("is true when scrollTop + clientHeight reaches scrollHeight exactly", () => {
    expect(isScrolledToEnd({ scrollTop: 800, clientHeight: 200, scrollHeight: 1000 })).toBe(true)
  })

  it("is true within the default threshold (a few px short due to subpixel rendering)", () => {
    expect(isScrolledToEnd({ scrollTop: 796, clientHeight: 200, scrollHeight: 1000 })).toBe(true)
  })

  it("is false when clearly not scrolled to the end", () => {
    expect(isScrolledToEnd({ scrollTop: 0, clientHeight: 200, scrollHeight: 1000 })).toBe(false)
  })

  it("is true when content is shorter than the panel (nothing to scroll)", () => {
    expect(isScrolledToEnd({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 })).toBe(true)
  })

  it("respects a custom threshold", () => {
    expect(isScrolledToEnd({ scrollTop: 750, clientHeight: 200, scrollHeight: 1000 }, 60)).toBe(true)
    expect(isScrolledToEnd({ scrollTop: 750, clientHeight: 200, scrollHeight: 1000 }, 10)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-scroll-detection.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/components/mou/mou-scroll-panel.tsx
"use client"

import { useCallback } from "react"
import { CheckCircle2 } from "lucide-react"

// Pure and exported for testing — a real <div>'s scroll metrics satisfy
// this shape, but no DOM/jsdom is needed to test the threshold math
// (this codebase has no component-testing setup — see the plan doc's
// Global Constraints).
export function isScrolledToEnd(
  el: { scrollTop: number; scrollHeight: number; clientHeight: number },
  thresholdPx = 8
): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - thresholdPx
}

export function MouScrollPanel({
  clauses,
  title,
  scrolledToEnd,
  onScrolledToEnd,
}: {
  clauses: string[]
  title: string
  scrolledToEnd: boolean
  onScrolledToEnd: () => void
}) {
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!scrolledToEnd && isScrolledToEnd(e.currentTarget)) onScrolledToEnd()
    },
    [scrolledToEnd, onScrolledToEnd]
  )

  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">{title}</p>
      <div
        onScroll={handleScroll}
        className="max-h-72 overflow-y-auto rounded-md border border-border bg-muted/20 p-4 text-sm space-y-3"
      >
        {clauses.map((clause, i) => (
          <p key={i}>
            <span className="font-semibold mr-1">{i + 1}.</span>
            {clause}
          </p>
        ))}
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        {scrolledToEnd ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            You've read the full MOU text.
          </>
        ) : (
          "Scroll to the end to enable acceptance below."
        )}
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-scroll-detection.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/mou/mou-scroll-panel.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/mou/mou-scroll-panel.tsx __tests__/mou-scroll-detection.test.ts
git commit -m "feat(mou): add scroll-gated MOU acceptance panel"
```

---

### Task 7: `type-specific-section.tsx` — generic field renderer

**Files:**
- Create: `src/components/mou/type-specific-section.tsx`
- Test: `__tests__/mou-type-specific-defaults.test.ts`

**Interfaces:**
- Consumes: `TypeSpecificFieldDef` (Task 3).
- Produces: `defaultTypeSpecificValues(fields: TypeSpecificFieldDef[]): Record<string, unknown>` (pure, tested — the initial form-state shape for a given type's fields); `<TypeSpecificSection fields={...} values={...} onChange={...} onUpload={...} uploadingKeys={Set<string>} emailVerified={boolean}>` (component, untested directly).

- [ ] **Step 1: Write the failing test for the pure default-values function**

```typescript
// __tests__/mou-type-specific-defaults.test.ts
import { describe, it, expect } from "vitest"
import { defaultTypeSpecificValues } from "@/components/mou/type-specific-section"
import type { TypeSpecificFieldDef } from "@/lib/mou/event-type-config"

describe("defaultTypeSpecificValues", () => {
  it("defaults text/textarea/number fields to empty string", () => {
    const fields: TypeSpecificFieldDef[] = [
      { key: "a", kind: "text", label: "A" },
      { key: "b", kind: "number", label: "B" },
    ]
    expect(defaultTypeSpecificValues(fields)).toEqual({ a: "", b: "" })
  })

  it("defaults checkbox fields to false", () => {
    const fields: TypeSpecificFieldDef[] = [{ key: "c", kind: "checkbox", label: "C" }]
    expect(defaultTypeSpecificValues(fields)).toEqual({ c: false })
  })

  it("defaults radio fields to empty string", () => {
    const fields: TypeSpecificFieldDef[] = [{ key: "d", kind: "radio", label: "D", options: [] }]
    expect(defaultTypeSpecificValues(fields)).toEqual({ d: "" })
  })

  it("defaults faculty-rows to an empty array under key 'faculty'", () => {
    const fields: TypeSpecificFieldDef[] = [{ key: "faculty", kind: "faculty-rows", minRows: 1, maxRows: 20 }]
    expect(defaultTypeSpecificValues(fields)).toEqual({ faculty: [] })
  })

  it("defaults association-rows to an empty array under key 'partner_associations'", () => {
    const fields: TypeSpecificFieldDef[] = [{ key: "partner_associations", kind: "association-rows", maxRows: 10 }]
    expect(defaultTypeSpecificValues(fields)).toEqual({ partner_associations: [] })
  })

  it("defaults conditional-upload to an empty string under '<docType>_url'", () => {
    const fields: TypeSpecificFieldDef[] = [{ key: "x", kind: "conditional-upload", docType: "consent_guest_institution", label: "X", requiredWhen: { field: "institution_type", equals: "guest" } }]
    expect(defaultTypeSpecificValues(fields)).toEqual({ consent_guest_institution_url: "" })
  })

  it("defaults facilities-group items individually (checkbox->false, number->'')", () => {
    const fields: TypeSpecificFieldDef[] = [
      { key: "facilities", kind: "facilities-group", items: [{ key: "hall_a", kind: "checkbox", label: "Hall A" }, { key: "beds", kind: "number", label: "Beds" }] },
    ]
    expect(defaultTypeSpecificValues(fields)).toEqual({ facilities: { hall_a: false, beds: "" } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-type-specific-defaults.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```typescript
// src/components/mou/type-specific-section.tsx
"use client"

import { Loader2, Upload, X, Plus, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { TypeSpecificFieldDef } from "@/lib/mou/event-type-config"

export function defaultTypeSpecificValues(fields: TypeSpecificFieldDef[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    switch (field.kind) {
      case "text":
      case "textarea":
      case "number":
      case "radio":
        values[field.key] = ""
        break
      case "checkbox":
        values[field.key] = false
        break
      case "faculty-rows":
        values.faculty = []
        break
      case "association-rows":
        values.partner_associations = []
        break
      case "conditional-upload":
        values[`${field.docType}_url`] = ""
        break
      case "facilities-group": {
        const group: Record<string, unknown> = {}
        for (const item of field.items) group[item.key] = item.kind === "checkbox" ? false : ""
        values.facilities = group
        break
      }
    }
  }
  return values
}

interface TypeSpecificSectionProps {
  fields: TypeSpecificFieldDef[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  onUpload: (docType: string, file: File) => void
  uploadingKeys: Set<string>
  emailVerified: boolean
}

// One generic renderer over TypeSpecificFieldDef[] — rural_program and
// workshop supply different arrays (Task 3); this component doesn't know
// or care which type it's rendering.
export function TypeSpecificSection({ fields, values, onChange, onUpload, uploadingKeys, emailVerified }: TypeSpecificSectionProps) {
  return (
    <div className="space-y-4">
      {fields.map((field) => {
        switch (field.kind) {
          case "text":
          case "number":
            return (
              <div key={field.key}>
                <Label className="text-xs">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                <Input
                  type={field.kind}
                  value={String(values[field.key] ?? "")}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  className="mt-1"
                />
                {field.helperText && <p className="mt-1 text-xs text-muted-foreground">{field.helperText}</p>}
              </div>
            )
          case "textarea":
            return (
              <div key={field.key}>
                <Label className="text-xs">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                <textarea
                  value={String(values[field.key] ?? "")}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  maxLength={field.maxLength}
                  rows={3}
                  className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                {field.helperText && <p className="mt-1 text-xs text-muted-foreground">{field.helperText}</p>}
              </div>
            )
          case "checkbox":
            return (
              <label key={field.key} className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(values[field.key])}
                  onChange={(e) => onChange(field.key, e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input"
                />
                <span>
                  {field.label}
                  {field.helperText && <span className="block text-xs text-muted-foreground mt-0.5">{field.helperText}</span>}
                </span>
              </label>
            )
          case "radio":
            return (
              <div key={field.key}>
                <Label className="text-xs">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                <div className="mt-1 space-y-1.5">
                  {field.options.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name={field.key}
                        checked={values[field.key] === opt.value}
                        onChange={() => onChange(field.key, opt.value)}
                        className="h-4 w-4"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                {field.helperText && <p className="mt-1 text-xs text-muted-foreground">{field.helperText}</p>}
              </div>
            )
          case "conditional-upload": {
            const url = String(values[`${field.docType}_url`] ?? "")
            const uploading = uploadingKeys.has(field.docType)
            return (
              <div key={field.key}>
                <Label className="text-xs">{field.label}</Label>
                {url ? (
                  <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    <span>Uploaded</span>
                    <button type="button" onClick={() => onChange(`${field.docType}_url`, "")} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label className={cn("mt-1 flex items-center justify-center gap-2 rounded-md border border-dashed border-input px-3 py-2.5 text-sm text-muted-foreground", emailVerified ? "cursor-pointer hover:border-primary/50" : "opacity-50")}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploading ? "Uploading…" : "Click to upload (JPG, PNG, or PDF, max 5MB)"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="hidden"
                      disabled={!emailVerified || uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) onUpload(field.docType, file)
                        e.target.value = ""
                      }}
                    />
                  </label>
                )}
              </div>
            )
          }
          case "facilities-group": {
            const group = (values.facilities ?? {}) as Record<string, unknown>
            return (
              <div key={field.key}>
                <Label className="text-xs">Facilities</Label>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {field.items.map((item) =>
                    item.kind === "checkbox" ? (
                      <label key={item.key} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(group[item.key])}
                          onChange={(e) => onChange("facilities", { ...group, [item.key]: e.target.checked })}
                          className="h-4 w-4 rounded border-input"
                        />
                        {item.label}
                      </label>
                    ) : (
                      <div key={item.key}>
                        <Label className="text-xs">{item.label}</Label>
                        <Input
                          type="number"
                          value={String(group[item.key] ?? "")}
                          onChange={(e) => onChange("facilities", { ...group, [item.key]: e.target.value })}
                          className="mt-1"
                        />
                      </div>
                    )
                  )}
                </div>
              </div>
            )
          }
          case "faculty-rows": {
            const rows = (values.faculty ?? []) as Array<{ name: string; amasi_membership_number: string | null; speciality: string | null; is_amasi_member: boolean }>
            const setRows = (next: typeof rows) => onChange("faculty", next)
            return (
              <div key={field.key}>
                <Label className="text-xs">Faculty ({field.minRows}-{field.maxRows} rows)</Label>
                <div className="mt-2 space-y-3">
                  {rows.map((row, i) => (
                    <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-4 items-end border border-border rounded-md p-3">
                      <div>
                        <Label className="text-xs">Name</Label>
                        <Input value={row.name} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} className="mt-1" />
                      </div>
                      <div>
                        <Label className="text-xs">AMASI #</Label>
                        <Input value={row.amasi_membership_number ?? ""} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, amasi_membership_number: e.target.value } : r)))} className="mt-1" />
                      </div>
                      <div>
                        <Label className="text-xs">Speciality{!row.is_amasi_member && <span className="text-destructive ml-0.5">*</span>}</Label>
                        <Input value={row.speciality ?? ""} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, speciality: e.target.value } : r)))} className="mt-1" />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={row.is_amasi_member} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, is_amasi_member: e.target.checked } : r)))} />
                          AMASI member
                        </label>
                        <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {rows.length < field.maxRows && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { name: "", amasi_membership_number: null, speciality: null, is_amasi_member: true }])}>
                      <Plus className="h-3.5 w-3.5" /> Add faculty
                    </Button>
                  )}
                </div>
              </div>
            )
          }
          case "association-rows": {
            const rows = (values.partner_associations ?? []) as Array<{ name: string; consent_letter_url: string | null }>
            const setRows = (next: typeof rows) => onChange("partner_associations", next)
            const uploading = (i: number) => uploadingKeys.has(`consent_partner_association:${i}`)
            return (
              <div key={field.key}>
                <Label className="text-xs">Partner associations (max {field.maxRows})</Label>
                <div className="mt-2 space-y-3">
                  {rows.map((row, i) => (
                    <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-2 items-end border border-border rounded-md p-3">
                      <div>
                        <Label className="text-xs">Association name</Label>
                        <Input value={row.name} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} className="mt-1" />
                      </div>
                      <div className="flex items-center gap-2">
                        {row.consent_letter_url ? (
                          <span className="text-sm text-muted-foreground">Consent letter uploaded</span>
                        ) : (
                          <label className={cn("flex items-center gap-2 text-sm border border-dashed rounded-md px-3 py-2", emailVerified ? "cursor-pointer" : "opacity-50")}>
                            {uploading(i) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            Consent letter
                            <input
                              type="file"
                              accept="image/jpeg,image/png,application/pdf"
                              className="hidden"
                              disabled={!emailVerified || uploading(i)}
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) onUpload(`consent_partner_association:${i}`, file)
                                e.target.value = ""
                              }}
                            />
                          </label>
                        )}
                        <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {rows.length < field.maxRows && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { name: "", consent_letter_url: null }])}>
                      <Plus className="h-3.5 w-3.5" /> Add association
                    </Button>
                  )}
                </div>
              </div>
            )
          }
        }
      })}
    </div>
  )
}
```

Note: the association-row upload's `onUpload(docType, file)` call passes a composite key (`consent_partner_association:${i}`) rather than the bare docType, so Task 8's `application-form.tsx` upload handler must record the association's URL at the right row index, not overwrite a single shared field. Task 8 implements that lookup.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-type-specific-defaults.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Run type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/mou/type-specific-section.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/mou/type-specific-section.tsx __tests__/mou-type-specific-defaults.test.ts
git commit -m "feat(mou): add generic type-specific field renderer"
```

---

### Task 8: Wire `application-form.tsx`

**Files:**
- Modify: `src/components/mou/application-form.tsx`
- Test: `__tests__/mou-application-form-regression.test.ts` (new — logic-only regression checks, not a rendered-component test, per this codebase's convention)

**Interfaces:**
- Consumes: `isMouEventTypeConfig` (Task 3), `MouScrollPanel`/`isScrolledToEnd` (Task 6), `TypeSpecificSection`/`defaultTypeSpecificValues` (Task 7).
- Produces: nothing new — this task is pure wiring.

- [ ] **Step 1: Write a regression test asserting the other 7 types are structurally unaffected**

This test can't render the component (no testing-library in this repo), so it asserts against the config shape directly — the thing `application-form.tsx` branches on — which is an accurate proxy for "these 7 types take the untouched code path" given Step 3 below makes every new render branch conditional on `isMouEventTypeConfig(typeConfig)`.

```typescript
// __tests__/mou-application-form-regression.test.ts
import { describe, it, expect } from "vitest"
import { EVENT_TYPE_CONFIG, isMouEventTypeConfig } from "@/lib/mou/event-type-config"

describe("application-form.tsx branch condition (regression guard)", () => {
  it("the 7 non-framework types are NOT MouEventTypeConfig — they take the original render path", () => {
    const untouchedIds = ["fmas", "mmas", "dmas", "slcp", "nextgen", "meet_the_master", "zonal_event"] as const
    for (const id of untouchedIds) {
      expect(isMouEventTypeConfig(EVENT_TYPE_CONFIG[id])).toBe(false)
    }
  })

  it("rural_program and workshop ARE MouEventTypeConfig — they take the new render path", () => {
    expect(isMouEventTypeConfig(EVENT_TYPE_CONFIG.rural_program)).toBe(true)
    expect(isMouEventTypeConfig(EVENT_TYPE_CONFIG.workshop)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-application-form-regression.test.ts`
Expected: FAIL only if Task 3 didn't land correctly (it should already pass once Task 3's `isMouEventTypeConfig` exists — this test's purpose here is to lock in the invariant before Step 3 wires the component to depend on it, not to drive new production code).

- [ ] **Step 3: Wire `application-form.tsx`**

Add imports:
```typescript
import { isMouEventTypeConfig } from "@/lib/mou/event-type-config"
import { MouScrollPanel, isScrolledToEnd } from "@/components/mou/mou-scroll-panel"
import { TypeSpecificSection, defaultTypeSpecificValues } from "@/components/mou/type-specific-section"
```

Add new local state, right after the existing `const [form, setForm] = useState<FormState>(INITIAL_STATE)` block:
```typescript
  const isMouFramework = !!typeConfig && isMouEventTypeConfig(typeConfig)
  const [typeSpecificValues, setTypeSpecificValues] = useState<Record<string, unknown>>(() =>
    isMouFramework ? defaultTypeSpecificValues(typeConfig.typeSpecificFields) : {}
  )
  const setTypeSpecificValue = useCallback((key: string, value: unknown) => {
    setTypeSpecificValues((prev) => ({ ...prev, [key]: value }))
  }, [])
  const [agreements, setAgreements] = useState<Record<string, string>>({})
  const [scrolledToEnd, setScrolledToEnd] = useState(false)
  const [amasicWarningDismissed, setAmasicWarningDismissed] = useState(false)
  const [uploadingKeys, setUploadingKeys] = useState<Set<string>>(new Set())
```

Add a generic type-specific upload handler, alongside the existing `uploadPhoto`:
```typescript
  const uploadTypeSpecificFile = useCallback(
    async (docTypeKey: string, file: File) => {
      // docTypeKey is either a bare docType ("consent_guest_institution",
      // "brief_institution") or "consent_partner_association:<index>" for a
      // repeatable association row — see type-specific-section.tsx.
      const [docType, indexStr] = docTypeKey.split(":")
      setUploadingKeys((prev) => new Set(prev).add(docTypeKey))
      try {
        const fd = new FormData()
        fd.append("file", file)
        fd.append("docType", docType)
        fd.append("email", form.email.trim())
        const res = await fetch("/api/mou/applications/upload", { method: "POST", body: fd })
        const data = await res.json()
        if (!data.status) {
          toast.error(data.message || "Upload failed")
          return
        }
        if (indexStr !== undefined) {
          const index = Number(indexStr)
          setTypeSpecificValues((prev) => {
            const rows = [...((prev.partner_associations ?? []) as Array<{ name: string; consent_letter_url: string | null }>)]
            if (rows[index]) rows[index] = { ...rows[index], consent_letter_url: data.url }
            return { ...prev, partner_associations: rows }
          })
        } else {
          setTypeSpecificValues((prev) => ({ ...prev, [`${docType}_url`]: data.url }))
        }
        toast.success("File uploaded")
      } catch {
        toast.error("Upload failed. Please try again.")
      } finally {
        setUploadingKeys((prev) => {
          const next = new Set(prev)
          next.delete(docTypeKey)
          return next
        })
      }
    },
    [form.email]
  )
```

Extend `requiredFieldsFilled` to also require the scroll-gated acceptance + all agreements when `isMouFramework`:
```typescript
  const mouFrameworkReady =
    !isMouFramework ||
    (form.applicant_amasi_number.trim() !== "" &&
      scrolledToEnd &&
      typeConfig.agreements.every((a) => !!agreements[a.clauseRef]))

  const requiredFieldsFilled =
    form.organizer_name.trim() &&
    form.email.trim() &&
    form.phone_number.trim() &&
    form.primary_institution.trim() &&
    form.preferred_date_1.trim() &&
    (!fields.has("zone") || form.zone) &&
    form.agree_terms &&
    form.certify_accurate &&
    form.authority_confirm &&
    mouFrameworkReady
```

In `handleSubmit`, before the `fetch("/api/mou/applications", ...)` call, add the AMASICON warn-before-submit check (workshop only, dismissible per the design spec's resolved decision #4) and merge in the type-specific payload:
```typescript
      if (
        isMouFramework &&
        typeConfig.eventSubtypeWarning &&
        !amasicWarningDismissed &&
        form.event_name.toUpperCase().includes("AMASICON")
      ) {
        const confirmed = window.confirm(
          `${typeConfig.eventSubtypeWarning} Continue submitting this application anyway?`
        )
        if (!confirmed) return
        setAmasicWarningDismissed(true)
      }
```
(place this check at the very top of `handleSubmit`, before `if (!canSubmit) return`)

And extend the `payload` object — after the existing `if (fields.has("institution_photo") ...)` block, add:
```typescript
      if (isMouFramework) {
        Object.assign(payload, typeSpecificValues)
        payload.agreements = agreements
      }
```

Finally, in the JSX, replace the existing fixed "Agreements" `<Card>` with a conditional: when `isMouFramework`, render `<MouScrollPanel>` + `<TypeSpecificSection>` + the per-type agreement checkboxes instead of the generic 3-checkbox block; otherwise render the original block unchanged. Locate the existing:
```tsx
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Agreements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <CheckboxField label="I agree to the AMASI terms and conditions for hosting this event." checked={form.agree_terms} onChange={(v) => set("agree_terms", v)} />
          <CheckboxField label="I certify that all information provided in this application is accurate." checked={form.certify_accurate} onChange={(v) => set("certify_accurate", v)} />
          <CheckboxField label="I confirm I have the authority to submit this application on behalf of my institution." checked={form.authority_confirm} onChange={(v) => set("authority_confirm", v)} />
        </CardContent>
      </Card>
```
and wrap it:
```tsx
      {isMouFramework ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Additional details</CardTitle>
            </CardHeader>
            <CardContent>
              <TypeSpecificSection
                fields={typeConfig.typeSpecificFields}
                values={typeSpecificValues}
                onChange={setTypeSpecificValue}
                onUpload={uploadTypeSpecificFile}
                uploadingKeys={uploadingKeys}
                emailVerified={emailVerified}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">Memorandum of Understanding</CardTitle>
              <CardDescription>Read the full MOU below, then accept each declaration.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <MouScrollPanel
                clauses={typeConfig.mouClauses}
                title={typeConfig.mouTitle}
                scrolledToEnd={scrolledToEnd}
                onScrolledToEnd={() => setScrolledToEnd(true)}
              />
              <div className="space-y-3">
                {typeConfig.agreements.map((a) => (
                  <label
                    key={a.clauseRef}
                    className={cn("flex items-start gap-2 text-sm", scrolledToEnd ? "cursor-pointer" : "opacity-50")}
                  >
                    <input
                      type="checkbox"
                      disabled={!scrolledToEnd}
                      checked={!!agreements[a.clauseRef]}
                      onChange={(e) =>
                        setAgreements((prev) => {
                          const next = { ...prev }
                          if (e.target.checked) next[a.clauseRef] = new Date().toISOString()
                          else delete next[a.clauseRef]
                          return next
                        })
                      }
                      className="mt-0.5 h-4 w-4 rounded border-input"
                    />
                    <span>{a.text}</span>
                  </label>
                ))}
                <label className={cn("flex items-start gap-2 text-sm", scrolledToEnd ? "cursor-pointer" : "opacity-50")}>
                  <input
                    type="checkbox"
                    disabled={!scrolledToEnd}
                    checked={form.agree_terms && form.certify_accurate && form.authority_confirm}
                    onChange={(e) => {
                      set("agree_terms", e.target.checked)
                      set("certify_accurate", e.target.checked)
                      set("authority_confirm", e.target.checked)
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-input"
                  />
                  <span>
                    I have read the Memorandum of Understanding in full and agree to it on behalf of the organising
                    committee. I understand that accepting it here, with my OTP-verified email address, is my
                    electronic signature on this MOU and has the same effect as signing it by hand.
                  </span>
                </label>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Agreements</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <CheckboxField label="I agree to the AMASI terms and conditions for hosting this event." checked={form.agree_terms} onChange={(v) => set("agree_terms", v)} />
            <CheckboxField label="I certify that all information provided in this application is accurate." checked={form.certify_accurate} onChange={(v) => set("certify_accurate", v)} />
            <CheckboxField label="I confirm I have the authority to submit this application on behalf of my institution." checked={form.authority_confirm} onChange={(v) => set("authority_confirm", v)} />
          </CardContent>
        </Card>
      )}
```

Also make the existing "Venue" `<Card>`'s description reflect `requiresVenue` (currently hardcoded "Optional — fill in if already finalized."):
```tsx
          <CardDescription>{isMouFramework && typeConfig.requiresVenue ? "Required." : "Optional — fill in if already finalized."}</CardDescription>
```

And render `typeConfig.organizerNameLabel` in place of the hardcoded `"Organizer name"` label:
```tsx
            <Field label={(isMouFramework && typeConfig.organizerNameLabel) || "Organizer name"} required value={form.organizer_name} onChange={(v) => set("organizer_name", v)} />
```

Both source specs require AMASI membership number for rural_program and workshop specifically ("Make required: AMASI membership number" — rural spec §1; workshop spec §1 reuses this as-is) — every other type that has `"amasi_membership_number"` in its `fields` list (fmas/mmas/dmas/slcp) leaves it optional, so this can't just be a blanket `required` prop change. Locate the existing:
```tsx
            {fields.has("amasi_membership_number") && (
              <Field label="AMASI membership number" value={form.applicant_amasi_number} onChange={(v) => set("applicant_amasi_number", v)} />
            )}
```
and change to:
```tsx
            {fields.has("amasi_membership_number") && (
              <Field label="AMASI membership number" required={isMouFramework} value={form.applicant_amasi_number} onChange={(v) => set("applicant_amasi_number", v)} />
            )}
```
(the `mouFrameworkReady` change above already enforces this server-adjacent on the client's submit-gate; this is just the visible `*` marker.)

And, for workshop's small-state exception visibility/clearing behavior — in the `TypeSpecificSection` usage above, this logic doesn't belong in the generic renderer (it's a cross-field business rule specific to one type, per the design spec's "stays bespoke" note). Add it as a `useEffect` in `application-form.tsx` itself, right after the `typeSpecificValues` state declarations:
```typescript
  useEffect(() => {
    if (!isMouFramework || !typeConfig.smallStateException) return
    const { venueStateField, states } = typeConfig.smallStateException
    const currentState = form.venue_state
    const requested = typeSpecificValues.small_state_exception_requested
    if (requested && currentState && !states.includes(currentState)) {
      setTypeSpecificValues((prev) => ({ ...prev, small_state_exception_requested: false, small_state_faculty_count: "" }))
      toast.info(`Small-state faculty transport (clause 17) is not available for ${currentState} — request cleared.`)
    }
  }, [form.venue_state, typeSpecificValues.small_state_exception_requested, isMouFramework, typeConfig])
```
Add `useEffect` to the existing `import { useState, useCallback, useMemo } from "react"` line (becomes `useState, useCallback, useMemo, useEffect`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-application-form-regression.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run full type-check and lint**

Run: `npx tsc --noEmit && npx eslint src/components/mou/application-form.tsx`
Expected: PASS. If `tsc` flags `typeConfig` as possibly `EventTypeUiConfig` (missing the MOU-only fields) inside a block already guarded by `isMouFramework`/`isMouEventTypeConfig`, that's TypeScript not narrowing through the `isMouFramework` boolean derived earlier — use `isMouEventTypeConfig(typeConfig)` directly as the guard expression at each such call site (not the pre-computed `isMouFramework` variable) so the type-guard function's return-type predicate actually narrows.

- [ ] **Step 6: Run the full test suite**

Run: `npx vitest run`
Expected: all PASS, including every pre-existing MOU test file untouched by this task.

- [ ] **Step 7: Commit**

```bash
git add src/components/mou/application-form.tsx __tests__/mou-application-form-regression.test.ts
git commit -m "feat(mou): wire application-form.tsx to the shared MOU framework"
```

---

### Task 9: Wire the decide route + signed-PDF signature block

**Files:**
- Modify: `src/app/api/mou/review/[token]/decide/route.ts`
- Modify: `src/lib/mou/mou-pdf.tsx` (add the signature-block append, both numbered-clause templates)
- Test: `__tests__/mou-decide-signature.test.ts` (new)

**Interfaces:**
- Consumes: `markCounterSigned` (Task 2), `MouSignature` (Task 1).
- Produces: `generateMouPdf`'s signature accepts an optional `signature: MouSignature | null` 4th parameter — no other public interface changes.

- [ ] **Step 1: Write the failing test**

```typescript
// __tests__/mou-decide-signature.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

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
vi.mock("@/lib/mou/mou-pdf", () => ({ generateMouPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")) }))
vi.mock("@/lib/mou/notify", () => ({ sendOutcomeEmail: vi.fn(), sendWhatsAppNudge: vi.fn() }))
vi.mock("@/lib/mou/mou-signature", () => ({ markCounterSigned: vi.fn() }))
vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ upload: vi.fn().mockResolvedValue({ error: null }), getPublicUrl: () => ({ data: { publicUrl: "https://x/mou.pdf" } }) }) },
    from: () => ({ insert: () => ({ select: () => ({ single: vi.fn().mockResolvedValue({ data: { id: "event-1" }, error: null }) }) }) }),
  }),
}))

import { POST } from "@/app/api/mou/review/[token]/decide/route"
import { markCounterSigned } from "@/lib/mou/mou-signature"
import { EVENT_TYPE_CONFIG, isMouEventTypeConfig } from "@/lib/mou/event-type-config"

describe("POST /api/mou/review/[token]/decide — signature counter-signing", () => {
  beforeEach(() => vi.clearAllMocks())

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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-decide-signature.test.ts`
Expected: FAIL — route doesn't call `markCounterSigned` yet.

- [ ] **Step 3: Wire `decide/route.ts`**

Add imports:
```typescript
import { markCounterSigned } from "@/lib/mou/mou-signature"
import { isMouEventTypeConfig } from "@/lib/mou/event-type-config"
```

Inside the `if (action === "approved") { ... }` block, right after `createdEventId = eventRow.id` (end of the try block, still inside the outer `if (action === "approved")`), add:
```typescript
    if (isMouEventTypeConfig(typeConfig)) {
      await markCounterSigned(application.id, typeConfig.mouVersion, verified.row.role)
    }
```
Place this as its own statement after the inner event-auto-create `try/catch` block, still inside `if (action === "approved")` — it must run regardless of whether the event auto-create succeeded (counter-signing is not conditional on that best-effort side effect), and **it must run before Step 6's signature lookup below** — the PDF generated in this same request needs to see the counter-signature that was just written, not a stale pre-approval copy. Step 6 depends on this ordering; do not reorder them the other way.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/mou-decide-signature.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Add the PDF signature-block append (numbered-clause templates only — rural_program/workshop are the only two types with a `mou_signatures` row)**

In `src/lib/mou/mou-pdf.tsx`, change `generateMouPdf`'s signature to accept an optional signature record:
```typescript
import type { AcademicEventApplication, ApplicationTypeId } from "./types"
import type { MouSignature } from "./types"
```
(add to the existing type-only import line rather than a new line, if `MouSignature` can be added to the same `import type { ... } from "./types"` statement — check the current import and combine)

```typescript
export async function generateMouPdf(
  application: AcademicEventApplication,
  typeLabel: string,
  signature?: MouSignature | null
): Promise<Buffer> {
  let doc: React.ReactElement<DocumentProps>

  if (COLLEGE_OF_MAS_TYPES.includes(application.application_type_id)) {
    doc = renderCollegeOfMasMou(application, typeLabel)
  } else if (ARTICLE_TYPES.includes(application.application_type_id)) {
    doc = renderArticleMou(application)
  } else if (NUMBERED_CLAUSE_TYPES.includes(application.application_type_id)) {
    doc = renderNumberedClauseMou(application, signature ?? null)
  } else {
    throw new Error(`generateMouPdf: unsupported application_type_id "${application.application_type_id}"`)
  }

  return renderToBuffer(doc)
}
```

Update `renderNumberedClauseMou` to accept and render the signature block:
```typescript
function renderNumberedClauseMou(application: AcademicEventApplication, signature: MouSignature | null) {
  const template = getNumberedClauseTemplate(application.application_type_id)

  return (
    <Document>
      <Page size="A4" style={styles.page} wrap>
        <Text style={styles.letterheadOrg}>ASSOCIATION OF MINIMAL ACCESS SURGEONS OF INDIA</Text>
        <Text style={styles.letterheadTitle}>{template.title}</Text>
        <Text style={styles.letterheadContact}>
          AMASI Head Office 45 A, Pankaja Mill Rd, Ramanathapuram, Coimbatore, +914224223330 amasi.india@gmail.com
          www.amasi.org
        </Text>

        <Acknowledgment application={application} />

        {template.clauses.map((clause, i) => (
          <View style={styles.clauseRow} key={i}>
            <Text style={styles.clauseNum}>{i + 1}.</Text>
            <Text style={styles.clauseText}>{clause}</Text>
          </View>
        ))}

        <View style={styles.signatureBlock}>
          <Text style={styles.signatureLine}>Signed: _________________ (Hon Secretary of AMASI)</Text>
          <Text style={styles.signatureLine}>
            Signed: {application.organizer_name} (Organizing Secretary of {template.roleLabel})
          </Text>
          {signature && (
            <>
              <Text style={[styles.signatureLine, { marginTop: 10, fontSize: 8.5, color: "#555" }]}>
                Electronic signature record — {signature.signatory_name} ({signature.signatory_email}), accepted{" "}
                {formatDate(signature.accepted_at)} from IP {signature.ip_address}. Document hash:{" "}
                {signature.mou_sha256.slice(0, 16)}…
              </Text>
              {signature.approved_by && signature.approved_at && (
                <Text style={[styles.signatureLine, { fontSize: 8.5, color: "#555" }]}>
                  Counter-signed by {signature.approved_by} ({formatDate(signature.approved_at)}) on behalf of AMASI.
                </Text>
              )}
            </>
          )}
        </View>

        <Footer application={application} />
      </Page>
    </Document>
  )
}
```

- [ ] **Step 6: Pass the signature record into `generateMouPdf` from `decide/route.ts`**

Move the `generateMouPdf` call to after the signature lookup. Add, right before the existing `if (action === "approved") { mouBuffer = await generateMouPdf(application, typeLabel) ... }` block:
```typescript
  let signatureRecord: import("@/lib/mou/types").MouSignature | null = null
  if (action === "approved" && isMouEventTypeConfig(typeConfig)) {
    const supabaseForSignature = createAdminClient()
    const { data } = await supabaseForSignature
      .from("mou_signatures")
      .select("*")
      .eq("application_id", application.id)
      .eq("mou_version", typeConfig.mouVersion)
      .maybeSingle()
    signatureRecord = data
  }
```
And change:
```typescript
    mouBuffer = await generateMouPdf(application, typeLabel)
```
to:
```typescript
    mouBuffer = await generateMouPdf(application, typeLabel, signatureRecord)
```

**Ordering correction (caught in plan review before implementation):** the `markCounterSigned` call from Step 3 must run BEFORE this signature lookup, not after — both are already gated behind `action === "approved"`. If `markCounterSigned` ran after this fetch (or after `generateMouPdf`), the row read here would still have `approved_by`/`approved_at` as `null`, so the PDF's counter-signature block (Step 5's `{signature.approved_by && signature.approved_at && ...}` branch) would never render in the actual emailed PDF — silently defeating the whole point of embedding it. With Step 3 placed first, this fetch reads the row *after* the counter-signature was just written in the same request, so `signatureRecord.approved_by`/`approved_at` are populated and the PDF's counter-signature line renders correctly. The static "Signed: _________________ (Hon Secretary of AMASI)" line above it remains a placeholder as before — this task doesn't touch that, only the dynamic block below it.

- [ ] **Step 7: Run the full decide-route test file and type-check**

Run: `npx vitest run __tests__/mou-decide-signature.test.ts && npx tsc --noEmit && npx eslint "src/app/api/mou/review/[token]/decide/route.ts" src/lib/mou/mou-pdf.tsx`
Expected: all PASS. Also run the existing (untouched-in-scope) decide-route tests if a file like `__tests__/mou-decide.test.ts` exists from the original build, to confirm this task didn't regress it: `npx vitest run` (full suite) is the safest check.

- [ ] **Step 8: Commit**

```bash
git add "src/app/api/mou/review/[token]/decide/route.ts" src/lib/mou/mou-pdf.tsx __tests__/mou-decide-signature.test.ts
git commit -m "feat(mou): counter-sign on approval, embed signature block in generated PDF"
```

---

### Task 10: Admin view — generic type-specific rows, prominent flags, signature-anomaly flag

**Files:**
- Modify: `src/app/api/admin/mou-applications/[id]/route.ts`
- Modify: `src/app/admin/mou-applications/page.tsx`
- Test: `__tests__/mou-admin-detail-route.test.ts` (new)

**Interfaces:**
- Consumes: `isMouEventTypeConfig`, `TypeSpecificFieldDef` (Task 3).
- Produces: nothing new — this task only reads existing data and renders it.

- [ ] **Step 1: Write the failing test for the admin detail route's signature lookup**

```typescript
// __tests__/mou-admin-detail-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ getAdminSession: vi.fn().mockResolvedValue({ id: "admin-1" }) }))
vi.mock("@/lib/mou/supabase-helpers", () => ({
  getApplicationById: vi.fn().mockResolvedValue({ id: "app-1", application_type_id: "rural_program" }),
}))

const maybeSingleMock = vi.fn()
const remarksOrderMock = vi.fn().mockResolvedValue({ data: [] })

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "mou_signatures") {
        return { select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }
      }
      return { select: () => ({ eq: () => ({ order: remarksOrderMock }) }) }
    },
  }),
}))

import { GET } from "@/app/api/admin/mou-applications/[id]/route"

describe("GET /api/admin/mou-applications/[id] — signature anomaly detection", () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes hasSignature: true when a matching mou_signatures row exists", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "sig-1" }, error: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET({} as any, { params: Promise.resolve({ id: "app-1" }) })
    const body = await res.json()
    expect(body.hasSignature).toBe(true)
  })

  it("includes hasSignature: false (anomaly) when no matching row exists for a mou-framework type", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET({} as any, { params: Promise.resolve({ id: "app-1" }) })
    const body = await res.json()
    expect(body.hasSignature).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/mou-admin-detail-route.test.ts`
Expected: FAIL — route doesn't return `hasSignature` yet.

- [ ] **Step 3: Wire the admin detail route**

In `src/app/api/admin/mou-applications/[id]/route.ts`, add imports:
```typescript
import { isMouEventTypeConfig, getEventTypeConfig } from "@/lib/mou/event-type-config"
```

Replace the return statement:
```typescript
  return Response.json({ status: true, application, remarks: remarks ?? [] })
```
with:
```typescript
  const typeConfig = getEventTypeConfig(application.application_type_id)
  let hasSignature: boolean | null = null
  if (typeConfig && isMouEventTypeConfig(typeConfig)) {
    const { data: signature } = await supabase
      .from("mou_signatures")
      .select("id")
      .eq("application_id", id)
      .eq("mou_version", typeConfig.mouVersion)
      .maybeSingle()
    hasSignature = !!signature
  }

  return Response.json({ status: true, application, remarks: remarks ?? [], hasSignature })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run __tests__/mou-admin-detail-route.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Wire the admin page's `DetailDialog` and `DetailResponse` type**

In `src/app/admin/mou-applications/page.tsx`, add to the `DetailResponse` interface:
```typescript
interface DetailResponse {
  status: boolean
  application: AcademicEventApplication
  remarks: Remark[]
  hasSignature: boolean | null
}
```

Add the import:
```typescript
import { isMouEventTypeConfig, SHARED_TYPE_SPECIFIC_COLUMN_KEYS, type TypeSpecificFieldDef } from "@/lib/mou/event-type-config"
```

Inside `DetailDialog`, after `const remarks = data?.remarks ?? []`, add. Per the plan-review ruling in Task 3/Task 5: a `typeSpecificFields` key that's in `SHARED_TYPE_SPECIFIC_COLUMN_KEYS` lives on the application row directly (`app.amasi_year_of_joining`, not `app.type_specific_data.amasi_year_of_joining`) — reading every key from `type_specific_data` unconditionally (as an earlier draft of this task did) would silently show those 6 fields as blank, since Task 5 never writes them there:
```typescript
  const hasSignature = data?.hasSignature ?? null
  const typeConfig = app ? getEventTypeConfig(app.application_type_id) : null
  const isMouFramework = !!typeConfig && isMouEventTypeConfig(typeConfig)

  function typeSpecificValue(field: TypeSpecificFieldDef): string | null {
    if (!app) return null
    const typeSpecificData = app.type_specific_data as Record<string, unknown>
    if (field.kind === "facilities-group") {
      const group = (typeSpecificData.facilities ?? {}) as Record<string, unknown>
      return field.items
        .filter((i) => group[i.key])
        .map((i) => (i.kind === "checkbox" ? i.label : `${i.label}: ${group[i.key]}`))
        .join(" · ") || null
    }
    const value = SHARED_TYPE_SPECIFIC_COLUMN_KEYS.has(field.key)
      ? (app as unknown as Record<string, unknown>)[field.key]
      : typeSpecificData[field.key]
    if (value === undefined || value === null || value === "") return null
    return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)
  }
```

Add a new section into the dialog's JSX, right after the existing "Review & decision" `<div>` block and before the "MOU" `{app.status === "approved" && ...}` block:
```tsx
              {isMouFramework && typeConfig && "typeSpecificFields" in typeConfig && (
                <div>
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                    {typeConfig.label} details
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {typeConfig.typeSpecificFields
                      .filter((f) => f.kind !== "faculty-rows" && f.kind !== "association-rows" && f.kind !== "conditional-upload")
                      .map((f) => {
                        const value = typeSpecificValue(f)
                        return value ? <Field key={f.key} label={f.kind === "facilities-group" ? "Facilities" : f.label} value={value} /> : null
                      })}
                  </div>
                  {/* Prominent flags per the design spec's admin-view section */}
                  {app.application_type_id === "rural_program" && (app.type_specific_data as Record<string, unknown>).financial_assistance_requested === true && (
                    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
                      Financial assistance requested (up to ₹1,00,000)
                    </div>
                  )}
                  {app.application_type_id === "workshop" && (app.type_specific_data as Record<string, unknown>).small_state_exception_requested === true && (
                    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
                      Small-state faculty transport requested (clause 17) — this costs AMASI money. State: {String((app.type_specific_data as Record<string, unknown>).venue_state ?? app.venue_state)}, faculty count: {String((app.type_specific_data as Record<string, unknown>).small_state_faculty_count ?? "—")}
                    </div>
                  )}
                  {hasSignature === false && (
                    <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
                      Anomaly: no matching electronic-signature record found for this application.
                    </div>
                  )}
                </div>
              )}
```

- [ ] **Step 6: Run the full type-check, lint, and test suite**

Run: `npx tsc --noEmit && npx eslint "src/app/api/admin/mou-applications/[id]/route.ts" src/app/admin/mou-applications/page.tsx && npx vitest run`
Expected: all PASS

- [ ] **Step 7: Commit**

```bash
git add "src/app/api/admin/mou-applications/[id]/route.ts" src/app/admin/mou-applications/page.tsx __tests__/mou-admin-detail-route.test.ts
git commit -m "feat(mou): admin view shows type-specific data, prominent flags, signature anomaly"
```

---

## Final verification (after all 10 tasks)

- [ ] Run `npx tsc --noEmit` — 0 errors.
- [ ] Run `npx eslint .` (or the repo's `npm run lint`) — 0 errors.
- [ ] Run `npx vitest run` — every test file passes, including every pre-existing MOU test file untouched by this plan (confirms zero regression on the other 7 event types and the pre-existing signature/token/notify flows).
- [ ] Run `npx next build` — this plan does not knowingly introduce a new client-router hook (`useSearchParams`/`usePathname`/`useRouter`), but `application-form.tsx` gained a new `useEffect`, so a local build is required per this repo's own `AGENTS.md` "Local build after client-router hook changes" rule to be safe.
- [ ] Manually open `/mou/rural_program` and `/mou/workshop` in a browser and confirm: type-specific fields render, the MOU scroll panel gates the agreement checkboxes, faculty/partner-association repeatable rows work, and the other 7 `/mou/[type]` pages render exactly as before this plan (spot-check `/mou/fmas`).
- [ ] Confirm the `sql/040_mou_application_framework.sql` migration has NOT been applied to production — this plan explicitly stops short of that; applying it is a separate, explicit step outside subagent-driven-development's scope (matches this repo's standing "no out-of-band migrations" convention unless the user explicitly authorizes it, as they did for `sql/039` earlier in this project's history).

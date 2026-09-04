# MOU Application Framework (Rural Surgery Camp + Workshop/CME/Conference) — Design

## Goal

Realign the `rural_program` and `workshop` MOU application types on `/mou` to their
actual legal MOU text (25 and 26 clauses respectively), and — instead of building two
one-off forms — extract a shared, config-driven MOU application framework so a third
event type never needs its own form/route/upload code, only its own config data.

## Source specs (field-level and clause-level detail lives here, not repeated below)

- `/Users/prabhubalasubramaniam/Downloads/Rural Camp Membership Form.md` — Rural
  Surgery Camp, clauses 1–25. Every field, conditional rule, and declaration below
  traces to a clause number in this file.
- `/Users/prabhubalasubramaniam/Downloads/Rural Program Membership Access MOU Spec (1).md`
  — despite its filename, this is the **Workshop/CME/Conference** spec, clauses 1–26.
  §1 lists what's identical to rural (reuse as-is), §2 is a diff table of what's
  different, §3–§6 are workshop-only additions, §7 is its declarations list, §8 is its
  data-model delta, §9 is its admin-view delta.

## Correction to both specs' own embedded prompts

Both source files' "Claude Code prompt" sections ask for a new `workshop_cme` event
type. **That's wrong.** `EVENT_TYPE_CONFIG.workshop` (label "Workshop / CME /
Conference") and a full 26-clause `WORKSHOP_CLAUSES` array in `src/lib/mou/mou-pdf.tsx`
already exist and match the workshop spec's cited clauses exactly (spot-checked
clauses 4, 16, 17, 23). This design **realigns the existing `workshop` type** — the
same relationship the rural spec has to the existing `rural_program` type. No new
event-type id, no second card on `/mou`.

## Architecture: config-driven framework, not two forms

One form shell, one submission pipeline, one upload handler, one OTP-signature module.
`rural_program` and `workshop` are two data entries into the same engine; the other 7
existing MOU types are untouched and keep their current (simpler) shape.

```ts
export interface MouEventTypeConfig {
  id: ApplicationTypeId
  label: string
  description: string
  fields: MouFieldKey[]              // existing common-field toggles — unchanged mechanism

  mouClauses: string[]               // RURAL_PROGRAM_CLAUSES / WORKSHOP_CLAUSES, exported from mou-pdf.tsx
  mouTitle: string
  mouVersion: number                 // bump when mouClauses text changes; frozen per signed application
  organizerNameLabel?: string        // "Organizing Secretary name" for both types
  agreements: { clauseRef: string; text: string }[]

  minLeadDays?: number               // 45 for both
  requiresVenue?: boolean            // true for both; venue optional for the other 7 types
  confirmationNote?: string          // "AMASI HQ completes processing within two weeks..."

  typeSpecificFields: TypeSpecificFieldDef[]
  smallStateException?: {            // workshop only, clause 17
    chapterFlagField: string
    venueStateField: string
    states: string[]                 // lives in src/lib/mou/small-state-chapters.ts, not inline
  }
  eventSubtypeWarning?: string       // workshop only — AMASICON-exclusion notice

  pendingContent?: boolean           // unchanged, for meet_the_master / zonal_event
}

type TypeSpecificFieldDef =
  | { key: string; kind: "text" | "textarea" | "number"; label: string; required?: boolean; maxLength?: number; min?: number; max?: number }
  | { key: string; kind: "checkbox"; label: string; helperText?: string }
  | { key: string; kind: "radio"; label: string; options: { value: string; label: string }[]; required?: boolean; blockValue?: { value: string; message: string }; helperText?: string }
  | { key: "faculty"; kind: "faculty-rows"; minRows: number; maxRows: number }
  | { key: "partner_associations"; kind: "association-rows"; maxRows: number }
  | { key: string; kind: "conditional-upload"; docType: string; label: string; requiredWhen: { field: string; equals: string } }
  | { key: "facilities"; kind: "facilities-group"; items: { key: string; kind: "checkbox" | "number"; label: string }[] }
```

One generic form renderer (`<TypeSpecificSection>`) and one generic server-side
validator (`validateTypeSpecificFields()`) walk the same `typeSpecificFields` array —
this is what makes "shared code, not duplicated" real rather than aspirational.
`smallStateException` and `eventSubtypeWarning` stay bespoke (conditional business
rules / one line of copy, not worth a generic system).

## Data model

Fields identical across both types (registration fee, programme outline,
institution-type/consent uploads, faculty, partner associations, agreements) become
real shared columns on `academic_event_applications`. Everything that differs between
types goes into one `type_specific_data jsonb` column with a `_v` schema-version key,
so a third event type never needs another migration for its own fields.

`mou_signatures` is a new, type-agnostic, **append-only** table (one row per signed
application) — insert-only from application code except one narrow, deliberate
exception: `approved_by`/`approved_at` are set exactly once, by the decide route, on
approval (the Hon. Secretary's counter-signature). No other UPDATE or DELETE against
this table exists anywhere in the codebase, ever.

Migration file: `sql/040_mou_application_framework.sql` (new file; `sql/039` is never
edited). Every column addition is `add column if not exists`, nullable or defaulted —
fully additive.

```sql
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
  'jsonb object: {"<clauseRef>": "<ISO timestamp accepted>", ...} — shape is shared, content is per-type';
comment on column public.academic_event_applications.type_specific_data is
  'jsonb object holding fields unique to one event type, plus a "_v" schema-version key. rural_program keys: venue_setting, expected_beneficiaries, target_population, expected_surgeries, financial_assistance_requested, nearest_airport, nearest_airport_km, nearest_railhead, nearest_railhead_km, facilities{...}. workshop keys: event_subtype, expected_delegates, faculty_travel_mode, organised_by_state_chapter, small_state_exception_requested, small_state_faculty_count, email_circular_requested, facilities{...}.';

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
create index if not exists mou_signatures_application_idx on public.mou_signatures (application_id);
alter table public.mou_signatures enable row level security;
```

RLS enabled, no policies — matches every other table in `sql/039`. Service-role admin
client only.

## MOU acceptance = electronic signature

`MouScrollPanel` renders `typeConfig.mouClauses` (exported from `mou-pdf.tsx` — the
same source the PDF uses), gates the acceptance checkbox on scroll-to-end. On submit,
the **server** — never the client — computes
`sha256(typeConfig.mouClauses.join("\n") + typeConfig.mouVersion)` and writes it as
`mou_sha256`; a client-supplied hash is never accepted (closes the tampering path
where a client claims to have seen different text than it actually did). IP comes from
the existing `x-forwarded-for` extraction pattern already used in
`upload/route.ts`/`rate-limit.ts`; `otp_verified_at` comes from the same
`verifiedOtp` row already checked before `createApplication`, never a client-supplied
value — so the OTP verification and the MOU acceptance are structurally tied to the
same email in the same request. IP/user-agent are classified as audit/evidentiary data
with **intentional indefinite retention** (that is the entire point of the record),
stored in plain text, consistent with how every other PII field in this codebase is
stored (Supabase's disk-encryption-at-rest is the existing and sufficient posture — no
new app-level encryption layer). On approval, `decide/route.ts` calls
`markCounterSigned(applicationId, mouVersion, role)` and the generated PDF gets a
signature block appended (organiser + IP + timestamp; Hon. Secretary + timestamp;
hash) for both types.

## Server-side validation (mirrors every client rule — client-side is UX, server-side is the boundary)

`validateTypeSpecificFields(config, body)` walks `typeSpecificFields` and enforces:
`required` fields present; `maxLength`/`min`/`max`; `blockValue` (rural's Urban block)
rejected with its exact clause-4 message; `faculty-rows` between `minRows`/`maxRows`,
non-AMASI-member rows require `speciality`; `association-rows` capped at `maxRows`,
and at least 1 when `joint_programme === true`; `conditional-upload` required exactly
when its `requiredWhen` condition holds. Outside the field-def loop: `minLeadDays`
(45 days) checked server-side against both preferred dates; `requiresVenue` makes the
6 venue fields required; all `agreements` clause refs must be present and true;
workshop's `smallStateException` — when `small_state_exception_requested` — requires
`organised_by_state_chapter === true` AND `venue_state` in `SMALL_STATE_CHAPTER_STATES`
AND `small_state_faculty_count` in `[2, 3]`, rejected with the clause-17 message
otherwise.

## Uploads

Reuse the exact existing pattern in `src/app/api/mou/applications/upload/route.ts`
(magic-byte content sniff, server-generated UUID storage path, 5 MB cap, OTP-verified
gate, per-IP rate limit) — no new route. Extend `VALID_DOC_TYPES` with
`consent_guest_institution`, `brief_institution`, `consent_partner_association`
(repeatable: one upload call per partner-association row, same pattern the existing
two base photos already use for a single file each).

## Resolved decisions (2026-09-04, from Prabhu)

1. **`workshop` vs `workshop_cme`**: realign the existing `workshop` type. No new
   event-type id.
2. **Workshop base photos**: keep `workshop.fields` as-is — no `committee_member_photo`/
   `institution_photo` added. Neither spec asks for them on this type.
3. **Insert atomicity** (application insert + signature insert are two separate
   Supabase calls, no cross-table transaction in this codebase today): a failed
   signature-row insert immediately after a successful application insert returns a
   500 to the applicant (who can retry); the admin view flags any `rural_program`/
   `workshop` application with no matching `mou_signatures` row as an anomaly. No
   Postgres-function-wrapped atomic insert — not worth the added complexity here.
4. **AMASICON-name warning on the workshop form**: dismissible confirm, not a hard
   block — the spec's own wording is "warn before submit," distinct from rural's
   explicit "block submission" for an Urban venue.
5. **Year of joining / designation prefill**: no matching column found on `members` in
   this codebase — both fields stay manual entry (not lookup-prefilled) for both
   types.
6. **MOU preview before submit**: the in-form scroll panel (full clause text,
   scroll-gated checkbox) is the preview. No separate pre-submission PDF-preview
   endpoint.

## Files touched (implementation detail — see the plan doc for task breakdown)

- `sql/040_mou_application_framework.sql` (new)
- `src/lib/mou/types.ts` — extend `AcademicEventApplication`/`NewApplicationInput`,
  add `MouSignature`
- `src/lib/mou/event-type-config.ts` — `MouEventTypeConfig`, rewritten
  `rural_program`/`workshop` entries as data; other 7 types unchanged
- `src/lib/mou/mou-pdf.tsx` — export `RURAL_PROGRAM_CLAUSES`, `WORKSHOP_CLAUSES`
- `src/lib/mou/small-state-chapters.ts` (new) — `SMALL_STATE_CHAPTER_STATES`
- `src/lib/mou/mou-signature.ts` (new) — `computeMouHash`, `createMouSignature`,
  `markCounterSigned`
- `src/lib/mou/type-specific-validation.ts` (new) — `validateTypeSpecificFields`
- `src/components/mou/application-form.tsx` — wire in the new sections when
  `typeSpecificFields` is present; unchanged for the other 7 types
- `src/components/mou/type-specific-section.tsx` (new) — generic field renderer
- `src/components/mou/mou-scroll-panel.tsx` (new) — scroll-gated MOU acceptance
- `src/app/api/mou/applications/upload/route.ts` — extend `VALID_DOC_TYPES`
- `src/app/api/mou/applications/route.ts` — call the new validator, write
  `type_specific_data`, call `createMouSignature`
- `src/lib/mou/notify.ts` — append `typeConfig.confirmationNote` when present
- `src/app/api/mou/review/[token]/decide/route.ts` — call `markCounterSigned`, pass
  signature into `generateMouPdf`
- `src/app/admin/mou-applications/page.tsx` — generic `type_specific_data` detail
  rows + the two type-specific prominent flags

No `src/middleware.ts` changes — no new routes.

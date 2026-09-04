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

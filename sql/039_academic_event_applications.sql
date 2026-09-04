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

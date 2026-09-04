-- 039_academic_event_applications.sql
-- Native replacement for the 7 external Fillout/Airtable "MOU" application
-- forms (FMAS, MMAS, SLCP, Nextgen, Workshop, Rural Program, Meet the
-- Master) previously listed as static links on the WordPress
-- "Application Forms & MOU's for Academic Events" page.
--
-- One shared table rather than 7 — the Airtable schemas for these 7 types
-- are ~90% identical (organizer, institution, venue, dates, MOU checkboxes,
-- signature). Type-specific extras (event_name, expected_participants,
-- live_surgery_demo, etc.) are nullable columns rather than JSONB so the
-- admin review queue can filter/sort on them directly.
--
-- Run this manually in the Supabase SQL editor — this repo does not apply
-- schema migrations via MCP execute_sql (DML only).

create table if not exists public.academic_event_applications (
  id                        uuid primary key default gen_random_uuid(),

  application_type          text not null check (application_type in (
                               'fmas', 'mmas', 'slcp', 'nextgen',
                               'workshop', 'rural_program', 'meet_the_master'
                             )),

  -- Applicant / organizer
  organizer_name             text not null,
  amasi_membership_number    text,
  primary_institution        text not null,
  email                      text not null,
  phone_number                text not null,

  -- Event-specific extras (nullable — not every type uses every field)
  event_name                 text,
  event_type                 text,
  expected_participants      text,
  live_surgery_demo          boolean,
  nextgen_number              integer,

  -- Scheduling
  preferred_date_1           date not null,
  preferred_date_2           date,
  finalized_date              date,

  -- Venue
  venue_type                 text,
  venue_name                 text,
  venue_address               text,
  venue_city                  text,
  venue_state                 text,
  venue_zip                   text,
  venue_country                text default 'India',

  -- Facilities checkboxes
  auditorium_hall_a          boolean not null default false,
  auditorium_hall_b          boolean not null default false,
  av_equipment                boolean not null default false,
  endotrainers                 boolean not null default false,
  high_speed_internet         boolean not null default false,

  -- MOU agreement checkboxes
  agree_terms                boolean not null default false,
  certify_accurate            boolean not null default false,
  authority_confirm           boolean not null default false,

  -- Uploads (Supabase Storage `uploads` bucket public URLs)
  committee_member_photo_url text,
  institution_photo_url       text,
  signature_url                text,

  -- Admin review
  status                      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_notes                  text,
  approved_by                  text,
  approved_at                   timestamptz,
  zone                         text,
  points_awarded               integer,

  created_at                   timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists academic_event_applications_type_status_idx
  on public.academic_event_applications (application_type, status);

create index if not exists academic_event_applications_created_idx
  on public.academic_event_applications (created_at desc);

create index if not exists academic_event_applications_status_idx
  on public.academic_event_applications (status)
  where status = 'pending';

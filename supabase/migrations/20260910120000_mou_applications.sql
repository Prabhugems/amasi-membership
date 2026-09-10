-- Online applications for hosting AMASI academic events (replaces the
-- letterhead .docx forms linked from
-- https://amasi.org/application-forms-mous-for-academic-events/).
--
-- One row per application. The applicant's identity columns are copied from
-- `members` at submit time by the API (never from the request body) so the
-- row stays readable even if the member record changes later.
--
-- Event-specific answers live in `details` (jsonb) — the shape per event type
-- is declared in src/lib/mou-events.ts and validated server-side in
-- src/lib/mou-applications.ts before insert. Attachments are bare storage
-- paths in the `uploads` bucket (store paths, sign on read — see
-- src/lib/storage-url.ts).
--
-- Access: service-role only. RLS is enabled with no policies, matching the
-- otp_codes lockdown (4818c76). All reads/writes go through
-- createAdminClient() in API routes that do their own session checks.

create table if not exists public.mou_applications (
  id                      uuid primary key default gen_random_uuid(),
  reference_number        text not null unique,
  event_type              text not null
    check (event_type in ('amasicon','workshop','rural-camp','fmas','mmas','nextgen','slcp')),
  status                  text not null default 'submitted'
    check (status in ('submitted','under_review','approved','mou_sent','mou_signed','rejected','withdrawn')),

  -- applicant snapshot (from members, not the client)
  member_id               text not null,
  amasi_number            bigint,
  applicant_name          text not null,
  applicant_email         text not null,
  applicant_phone         text,
  applicant_address       text,
  member_since            date,

  -- common event fields
  event_title             text,
  proposed_date           date,
  proposed_end_date       date,
  proposed_year           integer,
  place                   text not null,
  state                   text,
  venue_name              text,
  venue_type              text
    check (venue_type is null or venue_type in ('institution','guest','private')),
  joint_with_association  boolean not null default false,
  partner_association     text,
  supporting_city_chapter text,
  supporting_state_chapter text,
  supporting_others       text,
  remarks                 text,

  -- event-specific answers + declarations + attachments
  details                 jsonb not null default '{}'::jsonb,
  declarations            jsonb not null default '{}'::jsonb,
  attachments             jsonb not null default '[]'::jsonb,

  -- review
  admin_notes             text,
  decision_reason         text,
  reviewed_by             text,
  reviewed_at             timestamptz,
  signed_mou_path         text,
  signed_mou_at           timestamptz,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists mou_applications_status_created_idx
  on public.mou_applications (status, created_at desc);
create index if not exists mou_applications_member_idx
  on public.mou_applications (member_id, created_at desc);
create index if not exists mou_applications_event_type_idx
  on public.mou_applications (event_type);

alter table public.mou_applications enable row level security;
-- No policies on purpose: anon/authenticated get nothing; service_role bypasses RLS.

comment on table public.mou_applications is
  'Member applications to host AMASI academic events (AMASICON, workshop/CME/conference, rural surgery camp, FMAS/MMAS/NextGen/SLCP courses). Service-role only.';

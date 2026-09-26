-- 056: "Request a change" flow for approved/completed MOU applications.
--
-- Once an application is approved/completed it's read-only to the
-- applicant (see src/app/api/mou/applications/[id]/edit/route.ts's status
-- gate) — this table lets them ask for a date/venue/faculty change instead
-- of silently editing a live application. The partial unique index caps it
-- at one pending request per application at a time, mirroring the
-- report/route.ts "can't resubmit while submitted/accepted" gate.
create table if not exists public.academic_event_change_requests (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid not null references public.academic_event_applications(id) on delete cascade,
  requested_date     date,
  requested_venue    jsonb,
  requested_faculty  jsonb,
  note               text,
  status             text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by         text,
  decided_at         timestamptz,
  decision_note      text,
  created_at         timestamptz not null default now()
);

create index if not exists academic_event_change_requests_application_idx
  on public.academic_event_change_requests (application_id, status);

create unique index if not exists academic_event_change_requests_one_pending_idx
  on public.academic_event_change_requests (application_id) where status = 'pending';

-- RLS enabled, no policies — default-deny. All access is via the
-- service-role admin client in API routes, matching this repo's
-- universal convention (see .claude/CONTEXT.md "Architectural decisions").
alter table public.academic_event_change_requests enable row level security;

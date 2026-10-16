-- 058: Admin-added "endorsed" events for the MOU calendar.
--
-- The MOU calendar at /admin/mou-applications shows every approved/completed
-- academic_event_applications row by event date. Some events are endorsed
-- by AMASI without ever going through the MOU application flow (e.g.
-- state-chapter conferences, blood donation drives, rural camps with an
-- MOU-only endorsement). Admins add those here so the calendar is the one
-- place that shows everything AMASI has endorsed.
--
-- Additive and standalone: no foreign keys into other tables, so dropping it
-- cannot affect applications or events.
create table if not exists public.mou_calendar_entries (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (char_length(btrim(title)) between 1 and 200),
  start_date     date not null,
  end_date       date,
  organizer      text,
  city           text,
  state          text,
  category       text not null default 'endorsed'
                 check (category in ('endorsed', 'conference', 'workshop', 'camp', 'other')),
  notes          text,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create index if not exists mou_calendar_entries_start_date_idx
  on public.mou_calendar_entries (start_date);

-- RLS enabled, no policies — default-deny. All access is via the
-- service-role admin client in API routes, matching this repo's
-- universal convention (see .claude/CONTEXT.md "Architectural decisions").
alter table public.mou_calendar_entries enable row level security;

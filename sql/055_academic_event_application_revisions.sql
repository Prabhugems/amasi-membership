-- 055: Applicant edit history for MOU applications.
--
-- Append-only, matching the academic_event_remarks/mou_signatures
-- convention in sql/039/sql/040 — never UPDATE or DELETE a row, only
-- INSERT. One row per successful applicant edit (change_source
-- 'applicant_edit') or resubmission after changes_requested
-- ('applicant_resubmit'). Deliberately no app-computed `version` integer:
-- nothing else in this codebase's Supabase writes uses a transaction, so a
-- max(version)+1 sequence would be racy under concurrent edits for no real
-- benefit to a single self-editing applicant — order by created_at desc.
create table if not exists public.academic_event_application_revisions (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.academic_event_applications(id) on delete cascade,
  snapshot        jsonb not null,
  changed_fields  jsonb not null,
  changed_by      text not null,
  change_source   text not null default 'applicant_edit'
                   check (change_source in ('applicant_edit', 'applicant_resubmit')),
  created_at      timestamptz not null default now()
);

create index if not exists academic_event_application_revisions_application_idx
  on public.academic_event_application_revisions (application_id, created_at desc);

-- RLS enabled, no policies — default-deny. All access is via the
-- service-role admin client in API routes, matching this repo's
-- universal convention (see .claude/CONTEXT.md "Architectural decisions").
alter table public.academic_event_application_revisions enable row level security;

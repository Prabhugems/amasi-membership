-- 054: Applicant self-service edit tokens.
--
-- A per-application, revocable, multi-use bearer token mailed to the
-- applicant so they can edit their own submission (while status is
-- submitted/under_review/changes_requested) without a login system. This
-- is deliberately NOT a row in academic_event_approval_tokens: that table's
-- shape (role, can_decide, action_taken/used_at single-use burn) is a
-- decision-workflow concept for reviewers, and doesn't fit a standing,
-- reusable edit credential. See src/lib/mou/edit-token.ts.
create table if not exists public.academic_event_edit_tokens (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.academic_event_applications(id) on delete cascade,
  token_hash      text not null unique,
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  last_used_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists academic_event_edit_tokens_application_idx
  on public.academic_event_edit_tokens (application_id);

-- RLS enabled, no policies — default-deny. All access is via the
-- service-role admin client in API routes, matching this repo's
-- universal convention (see .claude/CONTEXT.md "Architectural decisions").
alter table public.academic_event_edit_tokens enable row level security;

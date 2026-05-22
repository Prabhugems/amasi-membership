-- 034_announcements.sql
-- Member-facing announcements for the AMASI Mobile app.
--
-- Read path: GET /api/announcements (anonymous + IP-rate-limited; the
-- handler filters published=true AND audience='public').
--
-- `audience` is added now even though everything launches as 'public' —
-- it's cheap insurance so member-only announcements can ship later
-- without a second migration. The endpoint already filters on it.
--
-- NOTE on migration history: this lands in /sql/ to match the existing
-- 33-file convention (001..033). There is a parallel /supabase/migrations/
-- directory with one file (Phase 1 RBAC); reconciling the two is a
-- separate cleanup, not in scope here. See 20260519051759_phase_1_rbac_foundation.sql
-- header comment.

create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text not null,
  published   boolean not null default true,
  audience    text not null default 'public' check (audience in ('public', 'members')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Partial covering index for the only hot query: most-recent published
-- announcements. Smaller than a (published, created_at desc) composite
-- because it omits the unpublished rows entirely.
create index if not exists announcements_published_recent_idx
  on public.announcements (created_at desc)
  where published = true;

-- Seed: idempotent, only fires when the table is empty so re-applying
-- this migration in dev/local won't duplicate rows. Two seeds; both
-- vague-but-true so we don't ship a confident-but-wrong launch date.
insert into public.announcements (title, body, published, audience)
select * from (values
  (
    'Welcome to AMASI Members',
    'You can now view announcements, your membership card, and the member directory directly from the app.',
    true,
    'public'
  ),
  (
    'AMASICON 2026 is coming',
    'Details about AMASICON 2026 — venue, dates, and registration — will be announced here as soon as they are confirmed.',
    true,
    'public'
  )
) as v(title, body, published, audience)
where not exists (select 1 from public.announcements);

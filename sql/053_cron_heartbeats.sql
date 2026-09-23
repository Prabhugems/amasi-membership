-- 053: Cron heartbeat tracking (Part B, item 9).
--
-- No job in this repo previously recorded whether it actually ran — a
-- silently-broken cron (misconfigured schedule, a deploy that dropped the
-- route, an unhandled throw before the last line) had no way to surface
-- itself short of someone noticing the downstream effect days later. This
-- is a minimal last-success/last-error ledger, one row per job name,
-- written by src/lib/cron-heartbeat.ts at the end of each guarded job.
create table if not exists public.cron_heartbeats (
  job_name text primary key,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  last_alerted_at timestamptz,
  updated_at timestamptz not null default now()
);

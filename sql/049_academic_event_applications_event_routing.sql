-- 049: Per-application override of the type default (sql/048). Set at
-- submission time from academic_event_types.default_event_routing;
-- admin-overridable afterward via PATCH /api/admin/mou-applications/[id]/routing.
--
-- Nullable — existing rows are backfilled by
-- scripts/backfill-event-routing-*.ts, not a blind default here, so the
-- backfill script's dry run has something meaningful to report.
alter table public.academic_event_applications
  add column if not exists event_routing text
    check (event_routing in ('amasi', 'college', 'none'));

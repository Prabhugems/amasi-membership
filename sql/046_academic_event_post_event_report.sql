-- 046: Post-event report tracking for approved MOU applications.
--
-- The MOU itself already requires this (REPORTING AND COMPLIANCE §1:
-- "Convenor submits a comprehensive report with photographs within 15
-- days" of the event), but nothing in the schema tracked whether it
-- happened. Visibility only — a missing report doesn't block anything.
--
-- Cadence (src/lib/mou-report-reminders.ts): day 7 and day 15
-- post-event, a reminder nudges the applicant if not yet submitted.
-- Past day 15 with still nothing filed, a one-time escalation notifies
-- the Hon. Secretary and the relevant National Director instead — three
-- independent one-shot gates, each its own timestamp column so a cron
-- re-run never double-sends.
alter table public.academic_event_applications
  add column if not exists report_documents jsonb not null default '[]'::jsonb,
  add column if not exists report_notes text,
  add column if not exists report_submitted_at timestamptz,
  add column if not exists report_reminder_7_sent_at timestamptz,
  add column if not exists report_reminder_15_sent_at timestamptz,
  add column if not exists report_escalation_sent_at timestamptz;

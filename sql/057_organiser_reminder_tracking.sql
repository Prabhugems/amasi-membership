-- Organiser-facing MOU reminders (2026-09-29): weekly FMAS/MMAS setup-status
-- nudge + one-time 3-days-before-event delegate-count email. Both need their
-- own idempotency tracking, same shape as report_reminder_7_sent_at etc.
--
-- setup_status_last_sent_at: last time the weekly setup-status email went
-- out. Re-sent whenever it's null or more than 7 days old — this is a
-- recurring nudge, not a once-only reminder, so it's a "last sent"
-- timestamp rather than a boolean/claim flag.
--
-- event_reminder_3day_sent_at: once-only claim, same atomic-update-guard
-- pattern as the report reminder columns — set exactly once, 3 days before
-- the event's date.
--
-- APPLIED 2026-09-29 via Supabase MCP on explicit user go. Pre-flight: 15
-- academic_event_applications rows (6 fmas/mmas), neither column present.
-- Post-apply: both columns present, nullable, no default; all 15 existing
-- rows null on both — zero behaviour change.
alter table academic_event_applications
  add column if not exists setup_status_last_sent_at timestamptz,
  add column if not exists event_reminder_3day_sent_at timestamptz;

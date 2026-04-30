-- 029_draft_reminder_count.sql
-- Add per-draft reminder counter so bulk-draft-reminders.ts can cap
-- lifetime reminders. Pre-existing reminded drafts backfill to 1
-- (we don't have per-draft history; conservative — under-counts vs.
-- truth by 0-2 for drafts that received 2 reminders pre-migration,
-- worst case is 4 lifetime instead of 3, never re-spams to-zero).

ALTER TABLE draft_applications
  ADD COLUMN IF NOT EXISTS reminder_count integer NOT NULL DEFAULT 0;

UPDATE draft_applications
   SET reminder_count = 1
 WHERE reminder_sent_at IS NOT NULL
   AND reminder_count = 0;

COMMENT ON COLUMN draft_applications.reminder_count IS
  'Lifetime count of reminder emails sent. Bulk cron caps at 3 (selection predicate: reminder_count < 3).';

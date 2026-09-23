-- 052: Post-event report review workflow (Part B, item 8).
--
-- Report submission (sql/046) was previously terminal — POST .../report set
-- report_submitted_at and nothing else distinguished "submitted" from
-- "reviewed." This adds a status so an admin can Accept (closes the
-- application) or Return (with a note, organiser resubmits through the same
-- link). report_status stays null until first submission; the existing
-- `report_submitted_at is null` check remains authoritative for "not yet
-- submitted" everywhere else in the codebase (report reminders, digest).
alter table public.academic_event_applications
  add column if not exists report_status text
    check (report_status in ('submitted', 'accepted', 'returned')),
  add column if not exists report_reviewed_by text,
  add column if not exists report_reviewed_at timestamptz,
  add column if not exists report_return_note text;

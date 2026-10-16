-- 059: Cancelled MOU applications + zone on endorsed calendar events.
--
-- 1. "cancelled" status: an approved MOU whose event is called off (e.g. a
--    clash with another chapter's conference) used to have no honest status,
--    so the only options were to leave it "approved" or delete it. It now
--    keeps the record with who cancelled it, when, and why. Like "completed"
--    (sql/043) it is a status past "approved", not a rejection path.
-- 2. mou_calendar_entries.zone: same five zones as academic_event_applications
--    (sql/zone check), so the calendar can filter by zone and flag
--    same-zone date clashes across MOU and endorsed events.
--
-- Additive for old code: nothing writes "cancelled" until the cancel action
-- ships, and the new columns are nullable.
ALTER TABLE public.academic_event_applications
  DROP CONSTRAINT academic_event_applications_status_check;

ALTER TABLE public.academic_event_applications
  ADD CONSTRAINT academic_event_applications_status_check
  CHECK (status = ANY (ARRAY['submitted'::text, 'under_review'::text, 'changes_requested'::text, 'approved'::text, 'completed'::text, 'rejected'::text, 'cancelled'::text]));

ALTER TABLE public.academic_event_applications
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE public.mou_calendar_entries
  ADD COLUMN IF NOT EXISTS zone text
  CHECK (zone IS NULL OR zone IN ('North', 'South', 'East', 'West', 'Central'));

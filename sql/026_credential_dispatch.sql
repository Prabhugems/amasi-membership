-- 026: Per-credential dispatch state + admin notes.
--
-- Today the admin UI lets an admin verify a credential exists, but there's
-- no place to record what's been done with it. Adding 4 columns to
-- member_credentials so a single row tells the full story:
--   dispatch_status   pending | shipped | delivered | rto | n/a
--   tracking_number   courier reference (DTDC etc.)
--   dispatched_at     when shipped
--   dispatched_by     admin email that recorded the dispatch
--   notes             free-text internal note (call back, prefers WhatsApp, etc.)

ALTER TABLE member_credentials
  ADD COLUMN IF NOT EXISTS dispatch_status text,
  ADD COLUMN IF NOT EXISTS tracking_number text,
  ADD COLUMN IF NOT EXISTS dispatched_at   timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_by   text,
  ADD COLUMN IF NOT EXISTS notes           text;

CREATE INDEX IF NOT EXISTS idx_member_credentials_dispatch_status
  ON member_credentials (dispatch_status)
  WHERE dispatch_status IS NOT NULL;

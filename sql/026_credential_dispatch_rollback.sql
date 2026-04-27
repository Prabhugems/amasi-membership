-- Rollback for 026.
DROP INDEX IF EXISTS idx_member_credentials_dispatch_status;
ALTER TABLE member_credentials
  DROP COLUMN IF EXISTS dispatch_status,
  DROP COLUMN IF EXISTS tracking_number,
  DROP COLUMN IF EXISTS dispatched_at,
  DROP COLUMN IF EXISTS dispatched_by,
  DROP COLUMN IF EXISTS notes;

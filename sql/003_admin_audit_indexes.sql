-- Migration: add indexes to admin_audit_log for per-admin activity drill
-- Run this in Supabase Studio → SQL Editor.
--
-- Context: the /admin page now has an "Activity" button that opens a side
-- panel fetching /api/audit?adminEmail=<email>&limit=50 plus a summary
-- (?summary=true&since=<iso>) grouped by action. These indexes keep those
-- queries fast as the log grows.

-- Per-admin filter (used on every panel open)
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_email
  ON admin_audit_log (admin_email);

-- Combined filter + order (covers the main paginated feed query)
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_email_created_at
  ON admin_audit_log (admin_email, created_at DESC);

-- Action-level filter (used by the /audit page and summary counts)
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action
  ON admin_audit_log (action);

-- Date-bounded queries (summary param `since=<iso>`)
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
  ON admin_audit_log (created_at DESC);

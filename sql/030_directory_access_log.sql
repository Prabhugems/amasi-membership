-- 030_directory_access_log.sql
-- Audit trail for authenticated member-directory access. Every authenticated
-- /api/directory query writes one row capturing who viewed the directory,
-- what they searched for, how many results they saw, and their IP.
--
-- Per AMASI President's directive (May 2026), authenticated members now see
-- email + mobile on every active member in directory results. This table is
-- the audit trail required to make that surface defensible: if a member's
-- contacts are scraped, we can identify the viewer who pulled the records.
--
-- Write-only from the server-side admin client (createAdminClient). No RLS:
-- the table is never read by clients, only by admins via direct DB access.

-- viewer_member_id is TEXT (not UUID) because members.id is a TEXT column in
-- this project — confirmed via information_schema 2026-05-11. Originally
-- written as UUID per the directive's pseudocode; the FK fails with a type
-- mismatch against members.id.
CREATE TABLE IF NOT EXISTS directory_access_log (
  id BIGSERIAL PRIMARY KEY,
  viewer_member_id TEXT REFERENCES members(id),
  query_params JSONB,
  result_count INT,
  ip TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dir_access_viewer
  ON directory_access_log (viewer_member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dir_access_created
  ON directory_access_log (created_at DESC);

COMMENT ON TABLE directory_access_log IS
  'Audit trail of authenticated /api/directory queries. One row per request that returned contact-bearing results. See sql/030 header for rationale.';

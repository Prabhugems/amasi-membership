-- 033_members_updated_at_index.sql
-- Supports incremental sync via /api/members/sync?updated_since=...
--
-- Without this index, WHERE updated_at > $since triggers a full scan.
-- 18k rows is sub-second today, but the index keeps incremental sync
-- O(returned-rows) instead of O(table-size) as the member base grows.
--
-- Partial index excludes the ~214 legacy rows with updated_at IS NULL
-- (they're never returned by an updated_since filter anyway). Marginally
-- smaller index, same query plan.

CREATE INDEX IF NOT EXISTS idx_members_updated_at
  ON members (updated_at)
  WHERE updated_at IS NOT NULL;

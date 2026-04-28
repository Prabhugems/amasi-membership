-- 028_ocr_score.sql
-- PR 0: additive AI-confidence column for the reviewer queue.
-- Populated for new rows from PR 0 onwards. NOT backfilled.
-- Existing rows keep ocr_score = NULL; reviewer queue tolerates null.

ALTER TABLE membership_applications
  ADD COLUMN IF NOT EXISTS ocr_score numeric(5, 2);

COMMENT ON COLUMN membership_applications.ocr_score IS
  'AI scoring totalScore in 0.00-100.00. Null for rows submitted before PR 0.';

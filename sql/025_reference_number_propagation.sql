-- 025: Propagate reference_number to draft_applications and membership_payments
--
-- Goal: every stage of the application lifecycle (draft → payment → submitted
-- application) carries the same canonical AMASI-YYYY-XXXXXXXXXX identifier so
-- that ops and support can trace a user across tables with a single string.
--
-- The existing membership_applications.reference_number (format AMASI-YYYY-XXXX)
-- is the canonical ID — this migration does NOT introduce a new column name.
--
-- Changes:
--   1. draft_applications.reference_number  (nullable TEXT + unique partial index)
--   2. membership_payments.reference_number (nullable TEXT + index)
--   3. Backfill membership_payments from membership_applications via application_id
--   4. Backfill in-progress draft_applications with fresh generated values
--
-- Run order: after 024_storage_uploads_rls.sql
-- Safe to re-run: all DDL uses IF NOT EXISTS / IF EXISTS guards.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. draft_applications.reference_number
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE draft_applications
  ADD COLUMN IF NOT EXISTS reference_number TEXT;

-- Partial unique index: NULLs are excluded so that rows with no reference yet
-- do not collide.  Once a value is assigned it must be globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_applications_reference_number
  ON draft_applications (reference_number)
  WHERE reference_number IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. membership_payments.reference_number
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE membership_payments
  ADD COLUMN IF NOT EXISTS reference_number TEXT;

-- Non-unique index: one application can generate retried payment rows;
-- each carries the same reference_number for grouping.
CREATE INDEX IF NOT EXISTS idx_membership_payments_reference_number
  ON membership_payments (reference_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill membership_payments from membership_applications
--
-- Joins on application_id (the FK already present on membership_payments).
-- Only rows where the column is still NULL and a matching application exists
-- are updated, making this idempotent on re-run.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE membership_payments mp
SET    reference_number = ma.reference_number
FROM   membership_applications ma
WHERE  mp.application_id  = ma.id
  AND  mp.reference_number IS NULL
  AND  ma.reference_number IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill draft_applications for active (non-terminal) drafts
--
-- Generates fresh AMASI-{year}-{10 uppercase hex chars} values using the same
-- algorithm as src/lib/reference-number.ts:generateRefNumber():
--   randomBytes(5).toString("hex").toUpperCase()  →  ENCODE(gen_random_bytes(5), 'hex')
--
-- Only 'in_progress', 'stuck', 'payment_on_hold', and 'resumed' drafts receive
-- a value — terminal states (completed, expired, refunded, refund_initiated)
-- are left NULL because the application they produced already carries a
-- reference_number in membership_applications.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE draft_applications
SET    reference_number =
         'AMASI-'
         || EXTRACT(YEAR FROM created_at)::TEXT
         || '-'
         || UPPER(ENCODE(gen_random_bytes(5), 'hex'))
WHERE  reference_number IS NULL
  AND  status IN ('in_progress', 'stuck', 'payment_on_hold', 'resumed');

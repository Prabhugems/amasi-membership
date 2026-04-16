-- Migration: add NMC verification audit trail to membership_applications
-- Run this in Supabase Studio → SQL Editor before deploying the NMC tri-state change.
--
-- Stores status + timestamp + what NMC actually returned so admins can compare
-- without re-querying the public API.
--
-- Shape:
-- {
--   "status": "verified" | "name_mismatch" | "not_found" | "skipped",
--   "checked_at": "2026-04-16T12:34:56.789Z",
--   "returned_name": "Rajesh Kumar" | null,
--   "returned_council": "Karnataka Medical Council" | null,
--   "returned_degree": "MBBS, MS" | null
-- }

ALTER TABLE membership_applications
  ADD COLUMN IF NOT EXISTS nmc_verification JSONB;

-- Optional: index the status field for admin filtering (e.g., "show all skipped")
CREATE INDEX IF NOT EXISTS idx_membership_applications_nmc_status
  ON membership_applications ((nmc_verification->>'status'));

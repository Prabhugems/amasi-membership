-- 027: Split members.name into first_name / middle_name / last_name
--
-- Goal: the partner API at /api/v1/members/[amasi_number] (and any future
-- consumer that needs structured name fields) can return first/last name
-- without splitting members.name at runtime. Splitting is fragile because of
-- salutations ("Dr."), multi-word last names, and inconsistent legacy rows.
--
-- membership_applications already stores these three columns separately. The
-- three member-insert paths (applications/approve, lib/auto-approval, and
-- cron/sync-members) all already have the split values in scope — they just
-- weren't being copied. This migration adds the columns and backfills.
--
-- Run order: after 026_credential_dispatch.sql.
-- Safe to re-run: all DDL uses IF NOT EXISTS; backfills are idempotent
-- (only touch rows where the new columns are still NULL).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add columns
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS first_name  TEXT,
  ADD COLUMN IF NOT EXISTS middle_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name   TEXT;

CREATE INDEX IF NOT EXISTS idx_members_last_name  ON members (last_name);
CREATE INDEX IF NOT EXISTS idx_members_first_name ON members (first_name);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill from membership_applications via member_id (most accurate)
--
-- An approved application is linked to its member row via members.id =
-- applications.member_id. The application carries clean, separate name fields
-- because they were captured by the form. Copy them across.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE members m
SET    first_name  = ma.first_name,
       middle_name = ma.middle_name,
       last_name   = ma.last_name
FROM   membership_applications ma
WHERE  ma.member_id = m.id
  AND  m.first_name IS NULL
  AND  ma.first_name IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Best-effort split for legacy rows not linked to an application
--
-- Legacy members imported via cron/sync-members predate the application table
-- linkage. For these we split members.name conservatively:
--   - strip a leading salutation token (Dr., Dr, Prof., Mr., Mrs., Ms.)
--   - first remaining token       → first_name
--   - last remaining token        → last_name
--   - everything in between       → middle_name (NULL if none)
--
-- This is imperfect (multi-word last names get truncated) but is only the
-- fallback path; rows can be corrected manually later. Crucially the runtime
-- code never re-derives these — once written, they're authoritative.
--
-- NOTE: this UPDATE deliberately does NOT join on id. ~98 legacy rows imported
-- via early cron syncs have NULL `id`, so any CTE+JOIN approach silently skips
-- them. Computing the split inline matches every row that satisfies the WHERE.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE members
SET    first_name  = (regexp_split_to_array(
                        btrim(regexp_replace(name, '^\s*(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+', '', 'i')),
                        '\s+'
                      ))[1],
       last_name   = CASE WHEN array_length(regexp_split_to_array(
                                              btrim(regexp_replace(name, '^\s*(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+', '', 'i')),
                                              '\s+'), 1) >= 2
                          THEN (regexp_split_to_array(
                                  btrim(regexp_replace(name, '^\s*(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+', '', 'i')),
                                  '\s+'))[
                                array_length(regexp_split_to_array(
                                  btrim(regexp_replace(name, '^\s*(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+', '', 'i')),
                                  '\s+'), 1)]
                          ELSE NULL END,
       middle_name = CASE WHEN array_length(regexp_split_to_array(
                                              btrim(regexp_replace(name, '^\s*(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+', '', 'i')),
                                              '\s+'), 1) >= 3
                          THEN array_to_string(
                                 (regexp_split_to_array(
                                    btrim(regexp_replace(name, '^\s*(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+', '', 'i')),
                                    '\s+'))[
                                   2:array_length(regexp_split_to_array(
                                                    btrim(regexp_replace(name, '^\s*(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?)\s+', '', 'i')),
                                                    '\s+'), 1) - 1],
                                 ' ')
                          ELSE NULL END
WHERE  first_name IS NULL
  AND  name IS NOT NULL
  AND  btrim(name) <> '';

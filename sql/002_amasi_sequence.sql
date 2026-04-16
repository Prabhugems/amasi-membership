-- Migration: atomic AMASI membership number assignment via Postgres sequence
-- Run this in Supabase Studio → SQL Editor before deploying the submit-route change.
--
-- Why: the previous flow selected MAX(amasi_number) and added 1 in application code.
-- Concurrent submissions could read the same MAX and produce duplicate numbers.
-- A Postgres sequence issues each value exactly once, even under high concurrency.
--
-- The setval guarantees we never hand out a number already present in `members`,
-- in case the table has been populated beyond the nominal start point.

CREATE SEQUENCE IF NOT EXISTS amasi_number_seq START WITH 18136;

SELECT setval(
  'amasi_number_seq',
  GREATEST(COALESCE((SELECT MAX(amasi_number) FROM members), 18135), 18135)
);

-- Supabase does not expose `nextval` as an RPC by default, so wrap it in a
-- SECURITY INVOKER SQL function callable via supabase.rpc('next_amasi_number').
CREATE OR REPLACE FUNCTION next_amasi_number() RETURNS bigint AS $$
  SELECT nextval('amasi_number_seq');
$$ LANGUAGE SQL;

-- sql/037_otp_codes_hash_at_rest.sql
--
-- otp_codes stored one-time codes in clear text. On a shared database that
-- made read access to this table equivalent to signing in as any member for
-- the lifetime of a code.
--
-- Done in this pass, in order:
--   1. Purged the table -- 3,018 rows, ALL already expired (0 live), so no
--      in-flight sign-in was interrupted and nothing of value was lost.
--   2. REVOKE ALL FROM anon, authenticated. RLS was already enabled with zero
--      policies; the grants were the remaining gap -- one permissive policy or
--      a disabled RLS flag away from full CRUD for anon. Verified afterwards
--      that anon SELECT and INSERT both fail with 42501 permission denied,
--      which is a different and stronger failure than an RLS empty result.
--   3. This file: rename the column so its contents are unambiguous.
--
-- Safe as a plain rename because the table is EMPTY (verified: 0 rows). There
-- is no backfill, and there cannot be one -- a hash of a code nobody holds is
-- worthless, which is exactly why the purge came first.

alter table public.otp_codes rename column code to code_hash;

comment on column public.otp_codes.code_hash is
  'sha256 of the one-time code, hex. Never the code itself. Compare with otpMatches() in src/lib/otp-hash.ts; nothing may read this back to obtain a code.';

comment on table public.otp_codes is
  'One-time sign-in codes, hashed at rest. service_role only: RLS enabled with no policies, and anon/authenticated hold no grants.';

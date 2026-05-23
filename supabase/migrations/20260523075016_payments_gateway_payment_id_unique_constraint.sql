-- Convert membership_payments.gateway_payment_id from a partial unique index
-- into a proper unique constraint, so ON CONFLICT (gateway_payment_id) resolves.
--
-- BACKGROUND (2026-05-22 production outage)
-- -----------------------------------------------------------------------------
-- The `gateway_payment_id` column had a *partial* unique index — its definition
-- included a `WHERE (gateway_payment_id IS NOT NULL)` predicate. That index
-- enforced uniqueness for the dedup contract, but PostgreSQL's `ON CONFLICT
-- (col)` clause requires either a unique constraint OR a non-partial unique
-- index on the conflict target. A partial index does not match, even when
-- every row inserted satisfies its WHERE clause.
--
-- All three payment-writer call sites use `.upsert(..., { onConflict:
-- "gateway_payment_id", ignoreDuplicates: true })`:
--   - src/app/api/webhooks/razorpay/route.ts        (payment.captured handler)
--   - src/app/api/payments/verify/route.ts          (client-side verify)
--   - src/app/api/cron/reconcile-payments/route.ts  (hourly reconcile sweep)
--
-- When the partial index was the only thing on the column, every one of those
-- upserts threw `ON CONFLICT DO UPDATE requires inference specification or
-- constraint name` and returned 500 / fell into the Sentry-captured insertError
-- branches. Payments were captured by Razorpay but silently failed to land in
-- `membership_payments` for ~12 hours on 2026-05-22 — recovered only after we
-- swapped the partial index for a true unique constraint and the reconcile
-- cron re-ran. (Six applicants — Vidhi, Nishat, Punam, Shahnawaz, Barman, and
-- Zuka — needed manual application rebuilds against the recovered payments;
-- audit log entries 2026-05-23.)
--
-- WHAT THIS MIGRATION DOES
-- -----------------------------------------------------------------------------
-- Reproduces the in-place hotfix that was applied directly to production on
-- 2026-05-22:
--   1. Drops the partial unique index `membership_payments_gateway_payment_id_uniq`
--      iff it exists as a standalone index (not yet owned by a constraint).
--   2. Adds a unique constraint of the same name on (gateway_payment_id).
--      PostgreSQL implicitly creates a non-partial unique index to back the
--      constraint — same name, same column, but without the WHERE clause —
--      and ON CONFLICT now resolves against it.
--
-- IDEMPOTENCY
-- -----------------------------------------------------------------------------
-- The DO block below is a no-op on any database where the constraint is
-- already present (the current state of production as of 2026-05-23). It
-- handles all three possible starting states:
--   (a) constraint already exists                  -> NOTICE + return  (prod today)
--   (b) standalone partial/full index exists, no constraint -> drop + add
--   (c) neither exists                             -> just add
-- Safe to run repeatedly. Running against current live prod is state (a).

DO $$
DECLARE
  v_table     constant regclass := 'public.membership_payments'::regclass;
  v_conname   constant text     := 'membership_payments_gateway_payment_id_uniq';
  v_indexname constant text     := 'membership_payments_gateway_payment_id_uniq';
BEGIN
  -- (a) Constraint already present? Done.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = v_table
      AND conname  = v_conname
      AND contype  = 'u'
  ) THEN
    RAISE NOTICE
      'membership_payments_gateway_payment_id_uniq constraint already exists — migration is a no-op.';
    RETURN;
  END IF;

  -- (b) Index exists as standalone (not yet owned by a constraint)? Drop it.
  -- An index that already backs a constraint cannot be DROP INDEX'd directly,
  -- but case (a) above would have caught that. By here, the index is either
  -- absent or genuinely standalone.
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'membership_payments'
      AND indexname  = v_indexname
  ) THEN
    RAISE NOTICE
      'Dropping standalone index % (likely the pre-fix partial unique index)', v_indexname;
    EXECUTE format('DROP INDEX public.%I', v_indexname);
  END IF;

  -- (c) Add the unique constraint. PostgreSQL creates a non-partial unique
  -- index of the same name to back it.
  RAISE NOTICE
    'Adding UNIQUE constraint % on membership_payments(gateway_payment_id)', v_conname;
  EXECUTE format(
    'ALTER TABLE %s ADD CONSTRAINT %I UNIQUE (gateway_payment_id)',
    v_table::text, v_conname
  );
END $$;

-- Post-condition (advisory; not enforced):
--   SELECT contype FROM pg_constraint
--   WHERE conrelid = 'public.membership_payments'::regclass
--     AND conname  = 'membership_payments_gateway_payment_id_uniq';
--   -- expect: 'u'

-- Add refund tracking columns to membership_payments.
-- Required by /api/applications/refund (applicationId branch).
--
-- membership_payments.status is plain text (not an enum). Verified 2026-04-27:
-- existing writes use values: "paid", "stuck", "captured", "refunded", "refund_initiated", "failed".
-- Writing status='refunded' is safe without a schema migration.
ALTER TABLE membership_payments
  ADD COLUMN IF NOT EXISTS refund_id      text,
  ADD COLUMN IF NOT EXISTS refunded_at    timestamptz,
  ADD COLUMN IF NOT EXISTS refund_reason  text;

-- Add refund tracking columns to membership_payments.
-- Required by /api/applications/refund (applicationId branch).
ALTER TABLE membership_payments
  ADD COLUMN IF NOT EXISTS refund_id      text,
  ADD COLUMN IF NOT EXISTS refunded_at    timestamptz,
  ADD COLUMN IF NOT EXISTS refund_reason  text;

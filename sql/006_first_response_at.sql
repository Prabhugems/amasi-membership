-- Migration: add first_response_at for SLA tracking
-- Run in Supabase Studio → SQL Editor.
-- Records when an admin first replies to a ticket (used for SLA measurement).

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS first_response_at timestamptz;

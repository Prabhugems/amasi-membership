-- 022: Email campaign model — promote campaigns out of membership_audit_log JSONB.
-- Zero existing campaign_sent rows (verified 2026-04-24), so no backfill.
-- Table name is `email_campaigns` (not `campaigns`) because a pre-existing
-- `campaigns` table for event broadcasts already exists in the schema.

CREATE TABLE IF NOT EXISTS email_campaigns (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  template_key    text NOT NULL,
  name            text NOT NULL,
  category        text NOT NULL CHECK (category IN ('marketing','statutory')),
  target_fields   text[] NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','sending','paused','completed')),
  created_by      text,
  created_at      timestamptz DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status_created
  ON email_campaigns(status, created_at DESC);

CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id          uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  member_id            uuid NOT NULL,
  email                text NOT NULL,
  amasi_number         integer,
  name                 text,
  sent_at              timestamptz,
  send_error           text,
  update_detected_at   timestamptz,
  created_at           timestamptz DEFAULT now(),
  UNIQUE(campaign_id, member_id)
);
-- Sender picks next batch: sent_at IS NULL first, stable order.
CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_campaign_pending
  ON email_campaign_recipients(campaign_id, sent_at NULLS FIRST, id);
-- Attribution lookups from members-update handler.
CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_member_sent
  ON email_campaign_recipients(member_id, sent_at)
  WHERE sent_at IS NOT NULL AND update_detected_at IS NULL;

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at timestamptz;

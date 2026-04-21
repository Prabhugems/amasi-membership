-- 017: Draft applications table
-- Tracks multi-step membership applications so incomplete signups can be
-- resumed, monitored, and cleaned up by cron jobs.

CREATE TABLE IF NOT EXISTS draft_applications (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text        NOT NULL UNIQUE,
  phone               text,
  membership_type     text,                              -- LM, ALM, ACM, ILM
  current_step        int         DEFAULT 1,             -- step 1-6
  step_data           jsonb       DEFAULT '{}'::jsonb,   -- all collected data
  failure_reason      text,                              -- why it got stuck
  failure_step        int,
  status              text        DEFAULT 'in_progress'
    CONSTRAINT draft_applications_status_check CHECK (
      status IN (
        'in_progress',
        'stuck',
        'payment_on_hold',
        'resumed',
        'refund_initiated',
        'refunded',
        'completed',
        'expired'
      )
    ),
  payment_order_id    text,                              -- Razorpay order ID
  payment_id          text,                              -- Razorpay payment ID
  has_verified_payment boolean    DEFAULT false,
  reminder_sent_at    timestamptz,
  stale_since         timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Indexes for cron and lookup queries
CREATE INDEX IF NOT EXISTS idx_draft_applications_status      ON draft_applications(status);
CREATE INDEX IF NOT EXISTS idx_draft_applications_email       ON draft_applications(email);
CREATE INDEX IF NOT EXISTS idx_draft_applications_stale_since ON draft_applications(stale_since);

COMMENT ON TABLE draft_applications IS
  'Tracks in-progress membership applications across steps 1-6 so that '
  'incomplete signups can be resumed, stale drafts detected by cron, '
  'and payment edge-cases (holds, refunds) managed until completion or expiry.';

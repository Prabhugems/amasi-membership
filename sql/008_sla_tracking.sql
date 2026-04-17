-- SLA tracking columns for support tickets
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_due_at timestamptz;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sla_breached boolean DEFAULT false;

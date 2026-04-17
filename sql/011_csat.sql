-- CSAT (Customer Satisfaction) survey columns on support_tickets
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS csat_rating integer;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS csat_comment text;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS csat_sent_at timestamptz;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS csat_token text;

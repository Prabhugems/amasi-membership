-- Ticket merging support
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES support_tickets(id);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS merged_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_support_tickets_merged_into ON support_tickets (merged_into) WHERE merged_into IS NOT NULL;

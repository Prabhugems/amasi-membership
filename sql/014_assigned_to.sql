ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_to text;
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON support_tickets (assigned_to) WHERE assigned_to IS NOT NULL;

-- Add attachments column to support_tickets for files uploaded at ticket creation
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]';

-- Add attachments column to ticket_replies for files uploaded with replies
ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]';

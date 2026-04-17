-- Add internal notes support to ticket replies
-- Internal notes are visible only to admins and never shown to members
ALTER TABLE ticket_replies ADD COLUMN IF NOT EXISTS is_internal boolean DEFAULT false;

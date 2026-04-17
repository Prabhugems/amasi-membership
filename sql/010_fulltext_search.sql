-- Full-text search for support tickets
-- Add tsvector column for full-text search
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Populate from existing data
UPDATE support_tickets SET search_vector =
  to_tsvector('english', coalesce(name, '') || ' ' || coalesce(email, '') || ' ' ||
  coalesce(ticket_number, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(description, ''));

-- Auto-update on insert/update via trigger
CREATE OR REPLACE FUNCTION update_ticket_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.name, '') || ' ' || coalesce(NEW.email, '') || ' ' ||
    coalesce(NEW.ticket_number, '') || ' ' || coalesce(NEW.subject, '') || ' ' || coalesce(NEW.description, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ticket_search_vector ON support_tickets;
CREATE TRIGGER trg_ticket_search_vector
  BEFORE INSERT OR UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_ticket_search_vector();

-- GIN index for fast lookups
CREATE INDEX IF NOT EXISTS idx_support_tickets_search ON support_tickets USING GIN (search_vector);

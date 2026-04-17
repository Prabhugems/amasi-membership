CREATE TABLE IF NOT EXISTS ticket_routing_rules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  assigned_to text NOT NULL,
  priority_override text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Seed default rules
INSERT INTO ticket_routing_rules (category, assigned_to) VALUES
  ('Payment Issue', 'Payment Team'),
  ('Technical Issue', 'Technical Team'),
  ('Certificate/Card', 'Membership Team'),
  ('Profile Update', 'AMASI Admin'),
  ('Application Issue', 'AMASI Admin'),
  ('Other', 'AMASI Admin')
ON CONFLICT DO NOTHING;

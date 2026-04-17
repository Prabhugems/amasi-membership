CREATE TABLE IF NOT EXISTS reply_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  created_by text,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed from existing hardcoded templates
INSERT INTO reply_templates (title, body, sort_order) VALUES
  ('Acknowledging', 'We''re looking into this and will respond shortly. Thank you for your patience.', 1),
  ('Need reference #', 'Could you please provide your membership reference number so we can look into this further?', 2),
  ('Resolved', 'This has been resolved. Please check now and let us know if you face any further issues.', 3),
  ('Escalated', 'We''ve escalated this to the technical team. You will be notified once the issue has been addressed.', 4),
  ('Need screenshot', 'Could you please share a screenshot of the issue you''re facing? This will help us resolve it faster.', 5),
  ('Payment follow-up', 'We''ve checked with our payment team. Please allow up to 24 hours for the transaction to reflect. If the issue persists, kindly share your transaction ID.', 6)
ON CONFLICT DO NOTHING;

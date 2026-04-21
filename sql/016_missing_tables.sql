-- 016: Create tables that exist in production but have no migration files
-- These tables were created manually in Supabase. This migration documents their schemas.
-- Run only on fresh databases — on existing databases these tables already exist.

-- OTP codes (used for email/SMS verification)
CREATE TABLE IF NOT EXISTS otp_codes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  verified boolean DEFAULT false,
  attempts integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_email ON otp_codes(email);
CREATE INDEX IF NOT EXISTS idx_otp_codes_email_verified ON otp_codes(email, verified);

-- Notification logs (bulk email/WhatsApp send history)
CREATE TABLE IF NOT EXISTS notification_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type text NOT NULL, -- 'email', 'whatsapp', 'both'
  subject text,
  message text,
  filters jsonb,
  sent_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  total_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Membership audit log (profile change tracking)
CREATE TABLE IF NOT EXISTS membership_audit_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id text,
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  performed_by text,
  ip_address text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_membership_audit_entity ON membership_audit_log(entity_type, entity_id);

-- Membership upgrades (ACM → LM/ALM requests)
CREATE TABLE IF NOT EXISTS membership_upgrades (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  upgrade_number text,
  member_id uuid,
  amasi_number integer,
  member_name text,
  member_email text,
  from_type text,
  to_type text,
  asi_membership_no text,
  asi_state text,
  asi_certificate_url text,
  ai_verified boolean DEFAULT false,
  ai_confidence text,
  ai_flags text[],
  status text DEFAULT 'pending',
  review_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upgrades_member ON membership_upgrades(member_id);
CREATE INDEX IF NOT EXISTS idx_upgrades_status ON membership_upgrades(status);

-- Member clinics
CREATE TABLE IF NOT EXISTS member_clinics (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id uuid NOT NULL,
  clinic_name text,
  address text,
  city text,
  state text,
  country text DEFAULT 'India',
  pin_code text,
  phone text,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clinics_member ON member_clinics(member_id);

-- Member work experience
CREATE TABLE IF NOT EXISTS member_experiences (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  member_id uuid NOT NULL,
  position text,
  institution text,
  experience_from integer,
  experience_to integer,
  total_years numeric,
  is_current boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_experiences_member ON member_experiences(member_id);

-- Certificate signatories (president/secretary details for certificate generation)
CREATE TABLE IF NOT EXISTS certificate_signatories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  president_name text,
  president_sign_url text,
  secretary_name text,
  secretary_sign_url text,
  template_url text,
  from_date date,
  to_date date,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- WhatsApp templates (Gallabox template management)
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  template_id text NOT NULL,
  description text,
  variables text[],
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

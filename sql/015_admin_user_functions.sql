-- 015: Admin user management RPC functions
-- Requires pgcrypto extension (already enabled in Supabase by default)

-- Enable pgcrypto if not already enabled
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add updated_at column if missing
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Function: Create admin user with hashed password
CREATE OR REPLACE FUNCTION create_admin_user(
  p_email text,
  p_name text,
  p_password text,
  p_role text DEFAULT 'reviewer'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO admin_users (id, email, name, password_hash, role, is_active, created_at, updated_at)
  VALUES (
    gen_random_uuid(),
    lower(trim(p_email)),
    trim(p_name),
    crypt(p_password, gen_salt('bf')),
    p_role,
    true,
    now(),
    now()
  )
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

-- Function: Verify admin password and return admin record
CREATE OR REPLACE FUNCTION verify_admin_password(
  p_email text,
  p_password text
)
RETURNS TABLE(
  id uuid,
  email text,
  name text,
  role text,
  is_active boolean,
  totp_secret text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.email,
    a.name,
    a.role,
    a.is_active,
    a.totp_secret
  FROM admin_users a
  WHERE a.email = lower(trim(p_email))
    AND a.password_hash = crypt(p_password, a.password_hash)
    AND a.is_active = true;
END;
$$;

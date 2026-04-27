-- Add reference_number to otp_codes so verify can scope results to the exact
-- application that was identified during send-otp. Nullable so existing rows
-- (email-path OTPs created before this migration) are not broken.
ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS reference_number text;

CREATE INDEX IF NOT EXISTS idx_otp_codes_reference_number
  ON otp_codes(reference_number)
  WHERE reference_number IS NOT NULL;

-- 023: Member credentials — generic table for FMAS, DipMAS, MMAS, course certs.
-- Today only FMAS rows are inserted (8,820 records imported from Airtable).
-- The composite primary key (amasi_number, credential_type, year) lets a member
-- legitimately hold one of each type per year, and makes the seed script
-- idempotent via ON CONFLICT.

CREATE TABLE IF NOT EXISTS member_credentials (
  amasi_number      integer NOT NULL,
  credential_type   text    NOT NULL,
  year              integer NOT NULL,
  skill_course_id   integer,
  awarded_at        date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (amasi_number, credential_type, year)
);

CREATE INDEX IF NOT EXISTS idx_member_credentials_amasi
  ON member_credentials (amasi_number);

CREATE INDEX IF NOT EXISTS idx_member_credentials_type_year
  ON member_credentials (credential_type, year);

CREATE TABLE IF NOT EXISTS credential_templates (
  credential_type    text NOT NULL,
  year               integer NOT NULL,
  template_path      text NOT NULL,
  president_name     text,
  convocation_date   text,
  convocation_place  text,
  PRIMARY KEY (credential_type, year)
);

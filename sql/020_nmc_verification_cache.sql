-- 020_nmc_verification_cache.sql
-- Cache for NMC (National Medical Commission) API verification results.
-- Avoids repeated calls for the same registration number and provides
-- stale-cache fallback when the NMC gov API is down.

CREATE TABLE IF NOT EXISTS nmc_verification_cache (
  registration_number TEXT PRIMARY KEY,
  state_council TEXT NOT NULL,
  year_of_registration INTEGER,
  doctor_name TEXT NOT NULL,
  qualification TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'blacklisted', 'not_found')),
  raw_response JSONB,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('live_api', 'stale_cache'))
);

COMMENT ON TABLE nmc_verification_cache IS 'Cache for NMC Indian Medical Register API results. 30-day TTL with stale-cache fallback during API downtime.';

CREATE INDEX IF NOT EXISTS idx_nmc_cache_reg_number ON nmc_verification_cache(registration_number);

ALTER TABLE nmc_verification_cache ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'nmc_verification_cache' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON nmc_verification_cache FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Down migration:
-- DROP TABLE IF EXISTS nmc_verification_cache CASCADE;

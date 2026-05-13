-- 032_push_tokens.sql
-- Expo push-notification token registry for amasi-mobile, per Tech Spec §6.1.
--
-- Mobile clients register a token on app start (and on token-rotation events
-- from Expo). The route upserts on (member_id, expo_push_token) so repeat
-- registrations refresh last_seen_at / app_version / platform without churn.
--
-- member_id is TEXT (not UUID) because members.id is TEXT in this project —
-- same constraint documented in 030's header.
--
-- NB: a separate `device_tokens` table exists in this Supabase project with
-- a similar shape but FKs to users(id) UUID (the Supabase auth-user table).
-- It is unrelated and likely belongs to a sibling app that shares this
-- project (per .claude/CONTEXT.md). Do not merge or repurpose.

CREATE TABLE IF NOT EXISTS push_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id       TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('ios','android')),
  app_version     TEXT,
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_member
  ON push_tokens (member_id);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: writes go through service-role (createAdminClient) which
-- bypasses RLS. Enabling without policies is defense-in-depth in case a
-- future caller wires this to an anon/authenticated Supabase client.
-- Matches the directory_access_log (030) pattern.

COMMENT ON TABLE push_tokens IS
  'Expo push-token registry for amasi-mobile. See sql/032 header.';

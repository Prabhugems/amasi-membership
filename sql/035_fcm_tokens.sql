-- 035_fcm_tokens.sql
-- FCM (Firebase Cloud Messaging) push-token registry for the legacy
-- AMASI Flutter app (com.amasi.amasi v1.0.4+2). Distinct from
-- 032_push_tokens.sql which holds Expo push tokens for amasi-mobile —
-- different vendors, different platforms, different token shapes.
--
-- Tokens land here in two ways:
--   1. /api/common_member_otp_verify upserts when the Flutter binary
--      forwards `device_id` (Flutter's misnomer for the FCM token) in
--      the verify body. This is the auth-bound moment, so member_id is
--      populated.
--   2. /api/device_token_update receives the token at app boot before
--      login — anonymous, so member_id is null. Reconciled later when
--      the same token shows up in a verify call.
--
-- An anonymous row gets its member_id filled the first time the same
-- token arrives via OTP verify. Stale tokens (not seen in 90 days) can
-- be cleaned via a separate scheduled job.

CREATE TABLE IF NOT EXISTS public.fcm_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token        TEXT NOT NULL UNIQUE,
  member_id    TEXT REFERENCES public.members(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL DEFAULT 'fcm' CHECK (platform IN ('fcm','apns','web')),
  app_version  TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fcm_tokens_member
  ON public.fcm_tokens (member_id) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fcm_tokens_last_seen
  ON public.fcm_tokens (last_seen_at);

ALTER TABLE public.fcm_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: writes go through service-role (createAdminClient) which
-- bypasses RLS. Enabling without policies is defense-in-depth in case a
-- future caller wires this to an anon/authenticated Supabase client.
-- Matches the directory_access_log (030) + push_tokens (032) pattern.

COMMENT ON TABLE public.fcm_tokens IS
  'FCM push-token registry for the legacy Flutter AMASI app (com.amasi.amasi). See sql/035 header.';

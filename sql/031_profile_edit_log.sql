-- 031_profile_edit_log.sql
-- Idempotency dedupe for member self-update via X-Idempotency-Key.
--
-- Mobile clients can replay POST /api/members/[id]/update with the same
-- X-Idempotency-Key on offline-retry. The route looks up this table by
-- (member_id, idempotency_key); a hit returns 200 with idempotent_replay:true
-- without re-applying the update or writing a new membership_audit_log row.
-- A miss applies the update, writes the audit log, and inserts a row here.
--
-- member_id is TEXT (not UUID) because members.id is TEXT in this
-- project — same constraint documented in 030's header.

CREATE TABLE IF NOT EXISTS profile_edit_log (
  id              BIGSERIAL PRIMARY KEY,
  member_id       TEXT NOT NULL REFERENCES members(id),
  idempotency_key TEXT NOT NULL,
  fields_changed  JSONB NOT NULL,
  applied_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_profile_edit_log_member
  ON profile_edit_log (member_id, applied_at DESC);

COMMENT ON TABLE profile_edit_log IS
  'Idempotency log for /api/members/[id]/update — see sql/031 header.';

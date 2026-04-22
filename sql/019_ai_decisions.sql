-- 019_ai_decisions.sql
-- AI Decisions Observability Table
-- Records every AI scoring event for membership applications.
-- One row per scoring run — rescoring after clarification/resubmission
-- creates a NEW row (preserving history), not an update.
-- Outcome columns are populated later when admin/AI acts on the application.

CREATE TABLE IF NOT EXISTS ai_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES membership_applications(id) ON DELETE CASCADE,
  application_reference TEXT NOT NULL,
  scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  membership_type TEXT NOT NULL,

  -- Scoring data
  total_score NUMERIC NOT NULL,
  threshold NUMERIC NOT NULL DEFAULT 80,
  decision TEXT NOT NULL CHECK (decision IN ('auto_approved', 'manual_review', 'auto_approve_failed')),
  blocking_reason TEXT,

  -- Per-check breakdown
  check_results JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- External system status
  nmc_api_status TEXT,
  nmc_api_response_time_ms INTEGER,

  -- Input snapshot
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Outcome tracking (populated later)
  final_status TEXT,
  final_status_by TEXT,
  final_status_at TIMESTAMPTZ,
  override_reason TEXT,

  -- Performance
  scoring_duration_ms INTEGER,
  error JSONB
);

COMMENT ON TABLE ai_decisions IS 'Observability log for AI approval scoring. One row per scoring event. Outcome columns updated when admin/AI acts on the application.';

-- Indexes
CREATE INDEX idx_ai_decisions_application_id ON ai_decisions(application_id);
CREATE INDEX idx_ai_decisions_scored_at ON ai_decisions(scored_at DESC);
CREATE INDEX idx_ai_decisions_decision ON ai_decisions(decision);
CREATE INDEX idx_ai_decisions_membership_type ON ai_decisions(membership_type);

-- RLS: only service_role and authenticated admins can read
ALTER TABLE ai_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON ai_decisions
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Admin read access" ON ai_decisions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.email = auth.jwt() ->> 'email'
        AND admin_users.is_active = true
    )
  );

-- Down migration (in comment for reference):
-- DROP TABLE IF EXISTS ai_decisions CASCADE;

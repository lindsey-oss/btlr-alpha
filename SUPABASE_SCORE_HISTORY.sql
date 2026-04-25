-- ============================================================
-- BTLR Score History Table
-- Stores every Home Health Score computation for:
--   - trend tracking over time
--   - full audit/reconstruction of any score
--   - regression detection across engine versions
--   - patent evidence of deterministic, explainable scoring
--
-- Safe to run multiple times (idempotent).
-- ============================================================

-- Score snapshot table
CREATE TABLE IF NOT EXISTS score_snapshots (
  id                BIGSERIAL PRIMARY KEY,
  snapshot_id       TEXT        NOT NULL UNIQUE,   -- "snap_abc123_xyz"
  property_id       INTEGER     NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  engine_version    TEXT        NOT NULL DEFAULT '1.0.0',
  input_hash        TEXT        NOT NULL,           -- determinism check
  input_item_count  INTEGER     NOT NULL DEFAULT 0,
  final_score       INTEGER     NOT NULL,
  score_band        TEXT        NOT NULL,
  readiness_score   INTEGER,
  safety_score      INTEGER,
  maintenance_score INTEGER,
  confidence_score  INTEGER,
  data_completeness NUMERIC(4,3),                   -- 0.000–1.000
  score_narrative   TEXT,

  -- Full audit detail stored as JSONB for flexibility
  normalized_inputs JSONB,    -- NormalizedInputSummary[]
  deductions        JSONB,    -- ScoreDeduction[]
  resolved_items    JSONB,    -- ResolvedItem[]
  category_scores   JSONB,    -- CategoryScoreAudit[]
  flags_active      JSONB,    -- feature flag state at compute time

  -- Dual-run diff tracking (populated when dualRunComparison flag is on)
  legacy_score      INTEGER,
  score_delta       INTEGER,
  regression_flag   BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookups by property and time
CREATE INDEX IF NOT EXISTS idx_score_snapshots_property_time
  ON score_snapshots (property_id, computed_at DESC);

-- Index for regression detection (look up by hash)
CREATE INDEX IF NOT EXISTS idx_score_snapshots_hash
  ON score_snapshots (input_hash);

-- RLS
ALTER TABLE score_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own score snapshots" ON score_snapshots;
CREATE POLICY "Users can view own score snapshots"
  ON score_snapshots FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM properties WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert own score snapshots" ON score_snapshots;
CREATE POLICY "Users can insert own score snapshots"
  ON score_snapshots FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM properties WHERE user_id = auth.uid()
    )
  );

-- Snapshots are immutable — no UPDATE or DELETE for users
-- (service role can still clean up via admin)

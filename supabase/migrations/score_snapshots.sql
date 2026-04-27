-- BTLR: Score Snapshots Table
-- Patent Pending — Proprietary
--
-- Stores every score computation as a full audit record.
-- Written by the scoring pipeline (lib/scoring-pipeline.ts) via
-- score-snapshot-store.ts on every inspection upload and property load.
--
-- Purpose:
--   - Score history over time (trend line, before/after repairs)
--   - Regression detection (same inputs → same score, every engine version)
--   - Full deduction transparency (explain exactly why the score is what it is)
--   - Determinism verification (input_hash must match for same score)
--
-- Row policy: insert-only from the client. No updates, no deletes.
-- Users can read only their own property snapshots (RLS).

CREATE TABLE IF NOT EXISTS score_snapshots (
  -- Identity
  snapshot_id       text         PRIMARY KEY,   -- "snap_<ts>_<rand>" from generateSnapshotId()
  property_id       bigint       NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  computed_at       timestamptz  NOT NULL DEFAULT now(),
  engine_version    text         NOT NULL,       -- "2.0.0" etc — bumped when scoring logic changes

  -- Inputs
  input_item_count  integer      NOT NULL DEFAULT 0,
  input_hash        text         NOT NULL,       -- djb2 hash of scoring-relevant fields
  data_completeness numeric(4,3) NOT NULL DEFAULT 0  -- 0.000–1.000 fraction from verified sources
    CHECK (data_completeness >= 0 AND data_completeness <= 1),
  source_types      text[]       NOT NULL DEFAULT '{}',

  -- Score outputs
  final_score       integer      NOT NULL CHECK (final_score >= 0 AND final_score <= 100),
  score_band        text         NOT NULL,
  readiness_score   integer      CHECK (readiness_score  >= 0 AND readiness_score  <= 100),
  safety_score      integer      CHECK (safety_score     >= 0 AND safety_score     <= 100),
  maintenance_score integer      CHECK (maintenance_score >= 0 AND maintenance_score <= 100),
  confidence_score  integer      CHECK (confidence_score >= 0 AND confidence_score  <= 100),

  -- Full audit detail (JSONB — queryable but stored as structured blobs)
  normalized_inputs jsonb        NOT NULL DEFAULT '[]',  -- NormalizedInputSummary[]
  category_scores   jsonb        NOT NULL DEFAULT '[]',  -- CategoryScoreAudit[]
  deductions        jsonb        NOT NULL DEFAULT '[]',  -- ScoreDeduction[]
  resolved_items    jsonb        NOT NULL DEFAULT '[]',  -- ResolvedItem[]
  flags_active      jsonb        NOT NULL DEFAULT '{}',  -- feature flag snapshot

  -- Human-readable narrative
  score_narrative   text,

  -- Regression / dual-run diff fields (null unless dualRunComparison flag was active)
  legacy_score      integer,
  score_delta       integer,
  regression_flag   boolean      DEFAULT false
);

-- ── Indexes ────────────────────────────────────────────────────────────────

-- Most common query: "give me all snapshots for this property, newest first"
CREATE INDEX IF NOT EXISTS idx_score_snapshots_property_time
  ON score_snapshots (property_id, computed_at DESC);

-- Regression check: find last snapshot for a property by input hash
CREATE INDEX IF NOT EXISTS idx_score_snapshots_hash
  ON score_snapshots (property_id, input_hash, computed_at DESC);

-- Engine version queries (for migration validation)
CREATE INDEX IF NOT EXISTS idx_score_snapshots_engine_version
  ON score_snapshots (engine_version);

-- ── Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE score_snapshots ENABLE ROW LEVEL SECURITY;

-- Users can read snapshots only for properties they own
CREATE POLICY "Users read own score snapshots"
  ON score_snapshots FOR SELECT
  USING (
    property_id IN (
      SELECT id FROM properties WHERE user_id = auth.uid()
    )
  );

-- Users can insert snapshots only for their own properties
CREATE POLICY "Users insert own score snapshots"
  ON score_snapshots FOR INSERT
  WITH CHECK (
    property_id IN (
      SELECT id FROM properties WHERE user_id = auth.uid()
    )
  );

-- No updates or deletes — snapshots are immutable audit records
-- (enforce this at the application layer; no DELETE policy = no deletes)

-- ── Comments ───────────────────────────────────────────────────────────────

COMMENT ON TABLE score_snapshots IS
  'Immutable audit log of every BTLR Home Health Score computation. One row per scoring run.';

COMMENT ON COLUMN score_snapshots.input_hash IS
  'djb2 hash of scoring-relevant fields. Same hash = same inputs = must produce same score. Used for regression detection.';

COMMENT ON COLUMN score_snapshots.engine_version IS
  'Scoring engine version that produced this snapshot. Bumped in score-audit.ts whenever scoring logic changes.';

COMMENT ON COLUMN score_snapshots.data_completeness IS
  'Fraction of inputs from verified sources (inspection report, invoice, receipt). Drives the Score Confidence display.';

COMMENT ON COLUMN score_snapshots.deductions IS
  'Full list of every point deduction and credit applied, with reason and source. Enables complete score explanation.';

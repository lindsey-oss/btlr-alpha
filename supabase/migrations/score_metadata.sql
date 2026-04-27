-- BTLR: Score metadata columns on properties table
-- Persists the computed score date and confidence so they survive across sessions,
-- appear in admin views, and drive the Score Confidence UI bar without re-computing.
--
-- score_date       — ISO timestamp of the last score computation (inspection upload
--                    or re-analysis). Used for inspection renewal funnel.
-- score_confidence — 0–100 integer matching HomeHealthReport.confidence_score.
--                    Reflects how complete/reliable the score is based on inspection
--                    coverage. Displayed alongside Home Health Score in the UI.
--
-- Both are nullable: properties without any inspection data have no score yet.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS score_date       timestamptz  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS score_confidence integer      DEFAULT NULL
    CHECK (score_confidence IS NULL OR (score_confidence >= 0 AND score_confidence <= 100));

COMMENT ON COLUMN properties.score_date IS
  'Timestamp of the last Home Health Score computation. Null until first inspection is uploaded.';

COMMENT ON COLUMN properties.score_confidence IS
  'Confidence score (0–100) from the last scoring run. Reflects inspection coverage completeness. Null until first scoring run.';

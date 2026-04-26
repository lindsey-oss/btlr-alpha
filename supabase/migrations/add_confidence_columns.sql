-- ============================================================
-- BTLR: Add Pass 3 confidence scoring columns to findings
--
-- These three columns are populated by classifyFinding() during
-- inspection parsing. They are intentionally additive — the
-- existing findings table schema is unchanged.
--
-- confidence_score:
--   "high"        — AI category string + description both confirm category
--   "medium"      — only AI category string matched a named rule
--   "low"         — fell through to maintenance_upkeep, description confirms
--   "unconfirmed" — neither matched; flagged for human review
--
-- classification_reason:
--   Human-readable string explaining what triggered the classification.
--   Useful for debugging and future ML training data.
--
-- needs_review:
--   true when confidence_score = 'unconfirmed'. Surfaced as a
--   "Needs Review" badge in the Repairs accordion UI.
-- ============================================================

ALTER TABLE public.findings
  ADD COLUMN IF NOT EXISTS confidence_score      text    NOT NULL DEFAULT 'medium'
    CONSTRAINT findings_confidence_score_check
      CHECK (confidence_score IN ('high', 'medium', 'low', 'unconfirmed')),
  ADD COLUMN IF NOT EXISTS classification_reason text,
  ADD COLUMN IF NOT EXISTS needs_review          boolean NOT NULL DEFAULT false;

-- Index to quickly find all findings that need human review
CREATE INDEX IF NOT EXISTS findings_needs_review_idx
  ON public.findings (property_id, needs_review)
  WHERE needs_review = true;

COMMENT ON COLUMN public.findings.confidence_score IS
  'Pass 3 classification confidence: high | medium | low | unconfirmed';
COMMENT ON COLUMN public.findings.classification_reason IS
  'Human-readable explanation of what triggered this classification';
COMMENT ON COLUMN public.findings.needs_review IS
  'True when confidence_score = unconfirmed — neither category nor description matched any rule';

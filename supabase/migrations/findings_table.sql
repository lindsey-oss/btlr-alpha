-- ============================================================
-- BTLR: findings table
-- One row per finding. Replaces properties.inspection_findings
-- JSONB blob and index-based finding_statuses tracking.
--
-- normalized_finding_key is the stable dedup identity:
--   canonical_category + system + location + issue_type + desc_slug
-- It is generated deterministically from AI output — same
-- inspection report always produces the same keys.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.findings (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  property_id            bigint      NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Stable identity key — used for ON CONFLICT dedup
  normalized_finding_key text        NOT NULL,

  -- Display fields
  title                  text        NOT NULL,
  category               text        NOT NULL,   -- canonical BTLR key (roof_drainage_exterior, etc.)
  system                 text,                   -- original AI category string
  component              text,
  issue_type             text,
  description            text,
  location               text,

  -- Severity & scoring
  severity               text        NOT NULL DEFAULT 'info'
    CHECK (severity IN ('critical', 'warning', 'info')),
  scorable               boolean     NOT NULL DEFAULT false,
  score_impact           text        NOT NULL DEFAULT 'none'
    CHECK (score_impact IN ('high', 'medium', 'low', 'none')),

  -- Repair metadata
  recommended_action     text,
  estimated_cost_min     integer,
  estimated_cost_max     integer,

  -- User-controlled repair status — NEVER overwritten on upsert
  status                 text        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'dismissed', 'monitored')),

  -- Provenance
  source_document_id     uuid        NULL,
  raw_finding            jsonb,      -- complete original AI output for this finding

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),

  -- Unique per property: same property + same key = same finding (dedup)
  CONSTRAINT findings_property_key_unique UNIQUE (property_id, normalized_finding_key)
);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS findings_property_id_idx  ON public.findings (property_id);
CREATE INDEX IF NOT EXISTS findings_user_id_idx      ON public.findings (user_id);
CREATE INDEX IF NOT EXISTS findings_status_idx       ON public.findings (status);
CREATE INDEX IF NOT EXISTS findings_category_idx     ON public.findings (category);
CREATE INDEX IF NOT EXISTS findings_scorable_idx     ON public.findings (scorable);

-- ── updated_at trigger ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS findings_updated_at ON public.findings;
CREATE TRIGGER findings_updated_at
  BEFORE UPDATE ON public.findings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row Level Security ─────────────────────────────────────────────────────
ALTER TABLE public.findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users select own findings"
  ON public.findings FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users insert own findings"
  ON public.findings FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users update own findings"
  ON public.findings FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "users delete own findings"
  ON public.findings FOR DELETE
  USING (user_id = auth.uid());

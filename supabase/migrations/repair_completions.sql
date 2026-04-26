-- ============================================================
-- BTLR: repair_completions table
-- Records each individual repair completion event with
-- metadata: notes, receipt, score audit, completion date.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.repair_completions (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id          uuid,
  finding_key          text        NOT NULL,   -- matches findingKey(category, globalIdx) format
  category             text        NOT NULL,
  title                text,
  completed_at         timestamptz NOT NULL DEFAULT now(),
  notes                text,
  receipt_storage_path text,
  receipt_url          text,
  was_scorable         boolean     NOT NULL DEFAULT false,
  score_before         integer,
  score_after          integer,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_repair_completions_user_id     ON public.repair_completions (user_id);
CREATE INDEX IF NOT EXISTS idx_repair_completions_property_id ON public.repair_completions (property_id);
CREATE INDEX IF NOT EXISTS idx_repair_completions_finding_key ON public.repair_completions (finding_key);
CREATE INDEX IF NOT EXISTS idx_repair_completions_completed_at ON public.repair_completions (completed_at DESC);

ALTER TABLE public.repair_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own repair completions"
  ON public.repair_completions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users select own repair completions"
  ON public.repair_completions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users delete own repair completions"
  ON public.repair_completions FOR DELETE
  USING (user_id = auth.uid());

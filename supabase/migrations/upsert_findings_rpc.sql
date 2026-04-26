-- ============================================================
-- BTLR: upsert_findings_preserve_status(jsonb)
--
-- Explicit INSERT ... ON CONFLICT DO UPDATE that NEVER touches
-- the `status` or `created_at` columns.
--
-- Why an RPC instead of client-side .upsert():
--   Supabase JS .upsert() generates "DO UPDATE SET *" which
--   includes EVERY column in the payload. There is no safe way
--   to guarantee status exclusion at the JS layer without
--   constructing raw SQL. This function is the single,
--   auditable place where that guarantee lives.
--
-- Columns updated on conflict (fresh AI-derived data):
--   title, category, system, component, issue_type,
--   description, location, severity, scorable, score_impact,
--   recommended_action, estimated_cost_min, estimated_cost_max,
--   raw_finding, updated_at
--
-- Columns intentionally NOT updated on conflict:
--   status       — user repair tracking, must survive re-upload
--   created_at   — immutable insertion timestamp
-- ============================================================

CREATE OR REPLACE FUNCTION public.upsert_findings_preserve_status(
  p_findings jsonb
)
RETURNS void
LANGUAGE plpgsql
-- SECURITY INVOKER (default): runs as the calling user so Supabase
-- RLS policies on the findings table are fully enforced.
-- The INSERT policy (user_id = auth.uid()) and UPDATE policy
-- (user_id = auth.uid()) both apply on every row.
AS $$
BEGIN
  INSERT INTO public.findings (
    property_id,
    user_id,
    normalized_finding_key,
    title,
    category,
    system,
    component,
    issue_type,
    description,
    location,
    severity,
    scorable,
    score_impact,
    recommended_action,
    estimated_cost_min,
    estimated_cost_max,
    raw_finding
    -- status omitted → defaults to 'open' on first insert
    -- created_at omitted → defaults to now() on first insert
  )
  SELECT
    (elem->>'property_id')::bigint,
    (elem->>'user_id')::uuid,
    elem->>'normalized_finding_key',
    elem->>'title',
    elem->>'category',
    elem->>'system',
    elem->>'component',
    elem->>'issue_type',
    elem->>'description',
    elem->>'location',
    elem->>'severity',
    (elem->>'scorable')::boolean,
    elem->>'score_impact',
    NULLIF(elem->>'recommended_action', ''),
    (NULLIF(elem->>'estimated_cost_min', ''))::integer,
    (NULLIF(elem->>'estimated_cost_max', ''))::integer,
    CASE
      WHEN elem->>'raw_finding' IS NOT NULL THEN (elem->>'raw_finding')::jsonb
      ELSE elem
    END
  FROM jsonb_array_elements(p_findings) AS elem
  ON CONFLICT (property_id, normalized_finding_key)
  DO UPDATE SET
    title               = EXCLUDED.title,
    category            = EXCLUDED.category,
    system              = EXCLUDED.system,
    component           = EXCLUDED.component,
    issue_type          = EXCLUDED.issue_type,
    description         = EXCLUDED.description,
    location            = EXCLUDED.location,
    severity            = EXCLUDED.severity,
    scorable            = EXCLUDED.scorable,
    score_impact        = EXCLUDED.score_impact,
    recommended_action  = EXCLUDED.recommended_action,
    estimated_cost_min  = EXCLUDED.estimated_cost_min,
    estimated_cost_max  = EXCLUDED.estimated_cost_max,
    raw_finding         = EXCLUDED.raw_finding,
    updated_at          = now()
    -- status:     intentionally omitted — preserves open/completed/dismissed/monitored
    -- created_at: intentionally omitted — immutable
  ;
END;
$$;

-- Grant execute to authenticated users (Supabase anon key is blocked by RLS anyway)
GRANT EXECUTE ON FUNCTION public.upsert_findings_preserve_status(jsonb) TO authenticated;

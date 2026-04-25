-- ============================================================
-- BTLR Data Foundation — v1
-- Run in Supabase SQL Editor
--
-- Philosophy: PII lives only in auth.users (Supabase-managed).
-- All other tables reference user_id (uuid) but never store
-- email, name, or phone directly — keeping identity isolated
-- from home condition data for privacy-safe aggregation.
--
-- Safe to run against an existing database — uses
-- IF NOT EXISTS / DO $$ guards throughout.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- HELPER: auto-update updated_at on any table
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 1. PROPERTIES
--    One row per home. user_id is the only PII link.
--    Address stored for display; region_code used for analytics.
-- ============================================================
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS region_code          text,   -- state + 3-digit zip e.g. "CA-921"
  ADD COLUMN IF NOT EXISTS year_built           integer,
  ADD COLUMN IF NOT EXISTS sq_ft                integer,
  ADD COLUMN IF NOT EXISTS bedrooms             integer,
  ADD COLUMN IF NOT EXISTS bathrooms            numeric,
  ADD COLUMN IF NOT EXISTS home_type            text,   -- single_family | condo | townhouse | multi_family
  ADD COLUMN IF NOT EXISTS purchase_date        date,
  ADD COLUMN IF NOT EXISTS purchase_price       numeric,
  ADD COLUMN IF NOT EXISTS home_health_score    integer,       -- 0-100
  ADD COLUMN IF NOT EXISTS last_score_at        timestamptz,
  ADD COLUMN IF NOT EXISTS score_breakdown      jsonb DEFAULT '{}'::jsonb;
  -- score_breakdown: { roof: 85, hvac: 60, plumbing: 90, electrical: 95, ... }

-- Populate region_code from existing address data where missing
-- Format: {state abbr}-{first 3 digits of zip}
-- This is the only location identifier used in aggregate analytics
UPDATE properties
SET region_code = UPPER(
  regexp_replace(address, '.*, ([A-Z]{2}) (\d{3})\d{2}.*', '\1') || '-' ||
  substring(regexp_replace(address, '.*(\d{5}).*', '\1') FROM 1 FOR 3)
)
WHERE region_code IS NULL AND address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_properties_region ON properties (region_code);
CREATE INDEX IF NOT EXISTS idx_properties_user   ON properties (user_id);


-- ============================================================
-- 2. PROPERTY_SYSTEMS
--    Tracks each major system of a home individually.
--    Enables per-system health scores and aging analysis.
-- ============================================================
CREATE TABLE IF NOT EXISTS property_systems (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  property_id               uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  system_type               text NOT NULL,
  -- roof | hvac | plumbing | electrical | foundation | exterior |
  -- insulation | windows_doors | appliances | pest | other

  install_year              integer,
  last_serviced_at          date,
  condition_rating          integer CHECK (condition_rating BETWEEN 1 AND 10),
  estimated_remaining_years integer,
  notes                     text,
  metadata                  jsonb DEFAULT '{}'::jsonb
  -- metadata: { brand, model, serial, warranty_expiry, last_inspector_note }
);

ALTER TABLE property_systems ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_psys_property ON property_systems (property_id);
CREATE INDEX IF NOT EXISTS idx_psys_type     ON property_systems (system_type);

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users view own systems" ON property_systems;
  DROP POLICY IF EXISTS "Users insert own systems" ON property_systems;
  DROP POLICY IF EXISTS "Users update own systems" ON property_systems;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users view own systems"   ON property_systems FOR SELECT
  USING (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));
CREATE POLICY "Users insert own systems" ON property_systems FOR INSERT
  WITH CHECK (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));
CREATE POLICY "Users update own systems" ON property_systems FOR UPDATE
  USING (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));

CREATE TRIGGER property_systems_updated_at
  BEFORE UPDATE ON property_systems
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 3. INSPECTION_FINDINGS
--    Structured finding records. Replaces the inspection_findings
--    JSONB blob on properties for anything that needs querying.
--    The JSONB blob stays for backwards-compat / fast UI load.
-- ============================================================
CREATE TABLE IF NOT EXISTS inspection_findings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  system_id           uuid REFERENCES property_systems(id) ON DELETE SET NULL,

  source              text NOT NULL DEFAULT 'inspection_report',
  -- inspection_report | manual | ai_scan | repair_doc

  finding_key         text,          -- slug used for dedup e.g. "roof-flashing-damage"
  category            text NOT NULL, -- Roofing, HVAC, Plumbing …
  severity            text NOT NULL DEFAULT 'minor',
  -- critical | major | minor | informational

  description         text,
  location_in_home    text,          -- "Master bathroom", "Attic"
  estimated_cost_low  numeric,
  estimated_cost_high numeric,

  status              text NOT NULL DEFAULT 'open',
  -- open | in_progress | resolved | dismissed | monitoring

  found_at            date,
  resolved_at         timestamptz,
  dismissed_at        timestamptz,
  dismissed_reason    text
);

ALTER TABLE inspection_findings ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_if_property  ON inspection_findings (property_id);
CREATE INDEX IF NOT EXISTS idx_if_category  ON inspection_findings (category);
CREATE INDEX IF NOT EXISTS idx_if_status    ON inspection_findings (status);
CREATE INDEX IF NOT EXISTS idx_if_severity  ON inspection_findings (severity);

-- Analytics index: query by region+category without touching PII
CREATE INDEX IF NOT EXISTS idx_if_region_cat
  ON inspection_findings (category, severity)
  WHERE status != 'dismissed';

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users view own findings" ON inspection_findings;
  DROP POLICY IF EXISTS "Users insert own findings" ON inspection_findings;
  DROP POLICY IF EXISTS "Users update own findings" ON inspection_findings;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users view own findings"   ON inspection_findings FOR SELECT
  USING (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));
CREATE POLICY "Users insert own findings" ON inspection_findings FOR INSERT
  WITH CHECK (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));
CREATE POLICY "Users update own findings" ON inspection_findings FOR UPDATE
  USING (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));

CREATE TRIGGER inspection_findings_updated_at
  BEFORE UPDATE ON inspection_findings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 4. REPAIRS
--    Every completed or planned repair. Links finding → vendor.
--    Replaces repair_documents for structured repair history.
-- ============================================================
CREATE TABLE IF NOT EXISTS repairs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  property_id         uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  finding_id          uuid REFERENCES inspection_findings(id) ON DELETE SET NULL,
  system_id           uuid REFERENCES property_systems(id) ON DELETE SET NULL,
  vendor_id           uuid,          -- FK added below after vendors table

  status              text NOT NULL DEFAULT 'planned',
  -- planned | scheduled | in_progress | completed | cancelled | warranty_claim

  category            text,          -- same taxonomy as findings
  description         text,
  cost_estimate       numeric,
  actual_cost         numeric,
  permit_required     boolean DEFAULT false,
  permit_number       text,

  scheduled_date      date,
  completed_date      date,
  warranty_expiry     date,

  vendor_name         text,          -- denormalized for display even if vendor not in system
  vendor_phone        text,
  notes               text,
  line_items          jsonb DEFAULT '[]'::jsonb,
  -- [{ description, quantity, unit_price, total }]
  resolved_finding_keys jsonb DEFAULT '[]'::jsonb
);

ALTER TABLE repairs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_repairs_property   ON repairs (property_id);
CREATE INDEX IF NOT EXISTS idx_repairs_status     ON repairs (status);
CREATE INDEX IF NOT EXISTS idx_repairs_category   ON repairs (category);
CREATE INDEX IF NOT EXISTS idx_repairs_completed  ON repairs (completed_date DESC NULLS LAST);

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users view own repairs" ON repairs;
  DROP POLICY IF EXISTS "Users insert own repairs" ON repairs;
  DROP POLICY IF EXISTS "Users update own repairs" ON repairs;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users view own repairs"   ON repairs FOR SELECT
  USING (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));
CREATE POLICY "Users insert own repairs" ON repairs FOR INSERT
  WITH CHECK (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));
CREATE POLICY "Users update own repairs" ON repairs FOR UPDATE
  USING (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));

CREATE TRIGGER repairs_updated_at
  BEFORE UPDATE ON repairs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 5. DOCUMENTS
--    All uploaded files with structured metadata.
--    Augments existing storage bucket — adds queryable columns.
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id),
  repair_id       uuid REFERENCES repairs(id) ON DELETE SET NULL,
  finding_id      uuid REFERENCES inspection_findings(id) ON DELETE SET NULL,

  document_type   text NOT NULL,
  -- inspection_report | repair_receipt | warranty | permit |
  -- insurance | mortgage | invoice | other

  file_name       text NOT NULL,
  file_path       text NOT NULL,     -- Supabase storage path
  file_size       integer,
  mime_type       text,
  source_date     date,              -- date on the document itself
  extracted_data  jsonb DEFAULT '{}'::jsonb,
  -- AI-extracted structured data: { vendor, cost, systems_mentioned, dates }
  category        text,
  notes           text
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_docs_property ON documents (property_id);
CREATE INDEX IF NOT EXISTS idx_docs_type     ON documents (document_type);
CREATE INDEX IF NOT EXISTS idx_docs_user     ON documents (user_id);

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users view own documents row" ON documents;
  DROP POLICY IF EXISTS "Users insert own documents row" ON documents;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users view own documents row"   ON documents FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "Users insert own documents row" ON documents FOR INSERT
  WITH CHECK (user_id = auth.uid());


-- ============================================================
-- 6. TIMELINE_EVENTS
--    Append-only chronological log of everything that happens
--    to a home. Powers the home history timeline in the UI.
-- ============================================================
CREATE TABLE IF NOT EXISTS timeline_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  event_type      text NOT NULL,
  -- purchase | inspection_uploaded | finding_opened | finding_resolved |
  -- repair_completed | repair_planned | document_uploaded | system_updated |
  -- vendor_hired | score_changed | insurance_renewal | note_added

  title           text NOT NULL,
  description     text,
  event_date      timestamptz NOT NULL DEFAULT now(),

  related_id      uuid,              -- polymorphic: repair id, finding id, etc.
  related_type    text,              -- 'repair' | 'finding' | 'document' | 'system'

  metadata        jsonb DEFAULT '{}'::jsonb,
  -- { old_score, new_score, cost, vendor_name, severity, etc. }

  is_user_visible boolean DEFAULT true,
  is_milestone    boolean DEFAULT false
  -- milestones: purchase, first inspection, major repair, score improved >10pts
);

ALTER TABLE timeline_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_te_property ON timeline_events (property_id);
CREATE INDEX IF NOT EXISTS idx_te_date     ON timeline_events (event_date DESC);
CREATE INDEX IF NOT EXISTS idx_te_type     ON timeline_events (event_type);

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users view own timeline" ON timeline_events;
  DROP POLICY IF EXISTS "Users insert own timeline" ON timeline_events;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users view own timeline"   ON timeline_events FOR SELECT
  USING (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));
CREATE POLICY "Users insert own timeline" ON timeline_events FOR INSERT
  WITH CHECK (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));


-- ============================================================
-- 7. VENDORS
--    Master vendor registry. Populated from approved
--    vendor_applications and manually added contractors.
--    No homeowner PII — purely business/trade data.
-- ============================================================
CREATE TABLE IF NOT EXISTS vendors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  application_id      uuid REFERENCES vendor_applications(id) ON DELETE SET NULL,

  business_name       text NOT NULL,
  owner_name          text,
  trade_categories    text[] DEFAULT '{}',
  -- Roofing | HVAC | Plumbing | Electrical | Pest Control | etc.

  phone               text,
  email               text,
  website             text,
  address_city        text,
  address_state       text,
  address_zip         text,
  region_code         text,          -- state + 3-digit zip — for matching

  status              text NOT NULL DEFAULT 'active',
  -- active | inactive | probationary | suspended

  btlr_rating         numeric(3,1),  -- internal rating 0.0-5.0
  btlr_review_count   integer DEFAULT 0,
  google_rating       numeric(3,1),
  google_review_count integer,

  verified            boolean DEFAULT false,
  verified_at         timestamptz,
  is_featured         boolean DEFAULT false,
  service_zip_codes   text,          -- comma-separated or range
  notes               text
);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_vendors_region     ON vendors (region_code);
CREATE INDEX IF NOT EXISTS idx_vendors_categories ON vendors USING GIN (trade_categories);
CREATE INDEX IF NOT EXISTS idx_vendors_status     ON vendors (status);

-- Vendors are publicly readable (business info, no PII)
DO $$ BEGIN
  DROP POLICY IF EXISTS "Public can view active vendors" ON vendors;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Public can view active vendors" ON vendors FOR SELECT USING (status = 'active');

-- Add FK from repairs to vendors
ALTER TABLE repairs
  ADD CONSTRAINT IF NOT EXISTS repairs_vendor_id_fk
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL;

CREATE TRIGGER vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 8. HOME_TEAM
--    A homeowner's saved/preferred contractors per trade.
--    Links to vendors table if they're in the BTLR network;
--    allows custom entries for contractors outside BTLR.
-- ============================================================
CREATE TABLE IF NOT EXISTS home_team (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  property_id     uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  vendor_id       uuid REFERENCES vendors(id) ON DELETE SET NULL,
  -- null = custom/non-BTLR contractor

  trade_category  text NOT NULL,
  custom_name     text,              -- used when vendor_id is null
  custom_phone    text,
  custom_email    text,
  custom_website  text,

  is_preferred    boolean DEFAULT false,
  hired_count     integer DEFAULT 0,
  last_hired_at   date,
  notes           text
);

ALTER TABLE home_team ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ht_property ON home_team (property_id);
CREATE INDEX IF NOT EXISTS idx_ht_vendor   ON home_team (vendor_id);

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users view own home team" ON home_team;
  DROP POLICY IF EXISTS "Users insert own home team" ON home_team;
  DROP POLICY IF EXISTS "Users update own home team" ON home_team;
  DROP POLICY IF EXISTS "Users delete own home team" ON home_team;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users view own home team"   ON home_team FOR SELECT
  USING (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));
CREATE POLICY "Users insert own home team" ON home_team FOR INSERT
  WITH CHECK (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));
CREATE POLICY "Users update own home team" ON home_team FOR UPDATE
  USING (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));
CREATE POLICY "Users delete own home team" ON home_team FOR DELETE
  USING (property_id IN (SELECT id FROM properties WHERE user_id = auth.uid()));

CREATE TRIGGER home_team_updated_at
  BEFORE UPDATE ON home_team
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 9. ANALYTICS_EVENTS
--    Privacy-safe behavioral tracking.
--
--    Rules:
--    - user_id is nullable (null = not consented or anonymous)
--    - NEVER store email, name, address, or phone here
--    - event_data must be reviewed before insertion — no PII
--    - region_code only (not full address) for location context
--    - Session-level tracking only for non-consented users
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz NOT NULL DEFAULT now(),

  session_id      uuid NOT NULL,     -- browser session, no PII link if user_id null
  user_id         uuid,              -- nullable — only set when user consented
  property_id     uuid,              -- nullable — only for property-context events

  event_type      text NOT NULL,
  -- page_view | feature_used | search | finding_clicked | vendor_viewed |
  -- contractor_brief_sent | repair_logged | document_uploaded | score_viewed |
  -- category_selected | issue_submitted

  event_data      jsonb DEFAULT '{}'::jsonb,
  -- ALLOWED keys: feature_name, category, trade, search_term, score,
  --               severity, result_count, step_number, duration_ms
  -- NEVER allowed: email, name, address, phone, IP, device_id

  region_code     text,              -- aggregation only — no full address
  platform        text,              -- web | ios | android
  app_version     text
);

-- No RLS needed — insert-only from server; analytics reads are admin-only
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ae_event_type  ON analytics_events (event_type);
CREATE INDEX IF NOT EXISTS idx_ae_created     ON analytics_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ae_region      ON analytics_events (region_code);

DO $$ BEGIN
  DROP POLICY IF EXISTS "Service role analytics access" ON analytics_events;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Service role analytics access"
  ON analytics_events FOR ALL USING (auth.role() = 'service_role');


-- ============================================================
-- 10. AGGREGATED INSIGHTS (materialized views)
--     Pre-computed, k-anonymized regional data.
--     Never expose individual rows — only group aggregates.
--     Minimum group size: 50 properties (k=50 anonymity).
-- ============================================================

-- Regional system health by home age
CREATE MATERIALIZED VIEW IF NOT EXISTS insight_system_health_by_region AS
SELECT
  p.region_code,
  ps.system_type,
  CASE
    WHEN p.year_built IS NULL THEN 'unknown'
    WHEN p.year_built >= 2000 THEN '2000s+'
    WHEN p.year_built >= 1980 THEN '1980-1999'
    WHEN p.year_built >= 1960 THEN '1960-1979'
    ELSE 'pre-1960'
  END                                AS home_age_bucket,
  COUNT(*)                           AS sample_size,
  ROUND(AVG(ps.condition_rating), 1) AS avg_condition,
  ROUND(AVG(ps.estimated_remaining_years), 1) AS avg_remaining_years,
  ROUND(
    100.0 * SUM(CASE WHEN ps.condition_rating <= 4 THEN 1 ELSE 0 END) / COUNT(*),
    1
  )                                  AS pct_poor_condition
FROM property_systems ps
JOIN properties p ON p.id = ps.property_id
WHERE p.region_code IS NOT NULL
GROUP BY p.region_code, ps.system_type, home_age_bucket
HAVING COUNT(*) >= 50;  -- k-anonymity: suppress small groups

CREATE UNIQUE INDEX IF NOT EXISTS idx_insight_sys_health
  ON insight_system_health_by_region (region_code, system_type, home_age_bucket);

-- Regional finding frequency (what breaks most in each area)
CREATE MATERIALIZED VIEW IF NOT EXISTS insight_findings_by_region AS
SELECT
  p.region_code,
  f.category,
  f.severity,
  COUNT(*)                                AS finding_count,
  ROUND(AVG(f.estimated_cost_high), 0)   AS avg_cost_high,
  ROUND(AVG(f.estimated_cost_low), 0)    AS avg_cost_low,
  COUNT(DISTINCT f.property_id)          AS affected_properties
FROM inspection_findings f
JOIN properties p ON p.id = f.property_id
WHERE p.region_code IS NOT NULL
  AND f.status != 'dismissed'
GROUP BY p.region_code, f.category, f.severity
HAVING COUNT(DISTINCT f.property_id) >= 50;

CREATE UNIQUE INDEX IF NOT EXISTS idx_insight_findings
  ON insight_findings_by_region (region_code, category, severity);

-- Repair cost benchmarks by category + region
CREATE MATERIALIZED VIEW IF NOT EXISTS insight_repair_costs AS
SELECT
  p.region_code,
  r.category,
  COUNT(*)                               AS repair_count,
  ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY r.actual_cost), 0) AS cost_p25,
  ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY r.actual_cost), 0) AS cost_median,
  ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY r.actual_cost), 0) AS cost_p75,
  ROUND(AVG(r.actual_cost), 0)           AS cost_avg
FROM repairs r
JOIN properties p ON p.id = r.property_id
WHERE r.status = 'completed'
  AND r.actual_cost IS NOT NULL
  AND r.actual_cost > 0
  AND p.region_code IS NOT NULL
GROUP BY p.region_code, r.category
HAVING COUNT(*) >= 50;

CREATE UNIQUE INDEX IF NOT EXISTS idx_insight_repair_costs
  ON insight_repair_costs (region_code, category);

-- Refresh function (run nightly via pg_cron or Supabase scheduled function)
CREATE OR REPLACE FUNCTION refresh_aggregated_insights()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY insight_system_health_by_region;
  REFRESH MATERIALIZED VIEW CONCURRENTLY insight_findings_by_region;
  REFRESH MATERIALIZED VIEW CONCURRENTLY insight_repair_costs;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 11. SCORE RECALCULATION FUNCTION
--     Computes home_health_score from open findings.
--     Call after any finding status change or repair completion.
-- ============================================================
CREATE OR REPLACE FUNCTION recalculate_home_score(p_property_id uuid)
RETURNS integer AS $$
DECLARE
  v_score      integer := 100;
  v_critical   integer;
  v_major      integer;
  v_minor      integer;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE severity = 'critical' AND status NOT IN ('resolved','dismissed')),
    COUNT(*) FILTER (WHERE severity = 'major'    AND status NOT IN ('resolved','dismissed')),
    COUNT(*) FILTER (WHERE severity = 'minor'    AND status NOT IN ('resolved','dismissed'))
  INTO v_critical, v_major, v_minor
  FROM inspection_findings
  WHERE property_id = p_property_id;

  -- Deductions: critical = -15 each (cap at -45), major = -8 (cap at -32), minor = -2 (cap at -10)
  v_score := v_score - LEAST(v_critical * 15, 45);
  v_score := v_score - LEAST(v_major    * 8,  32);
  v_score := v_score - LEAST(v_minor    * 2,  10);
  v_score := GREATEST(v_score, 0);

  UPDATE properties
  SET home_health_score = v_score,
      last_score_at     = now()
  WHERE id = p_property_id;

  RETURN v_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ============================================================
-- 12. DATA RETENTION & PRIVACY CONTROLS
-- ============================================================

-- Tracks user consent for analytics
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS analytics_consent    boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS analytics_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS data_deletion_requested_at timestamptz;

-- Soft-delete helper: anonymize a user's data without breaking FK chains
CREATE OR REPLACE FUNCTION anonymize_user_data(p_user_id uuid)
RETURNS void AS $$
BEGIN
  -- Mark all their properties as deletion-requested (cascade handled by app)
  UPDATE properties
  SET data_deletion_requested_at = now()
  WHERE user_id = p_user_id;

  -- Null out user_id from analytics (keep aggregate-safe rows)
  UPDATE analytics_events
  SET user_id = NULL
  WHERE user_id = p_user_id;

  -- Null out user_id from documents (storage files handled separately)
  UPDATE documents
  SET user_id = '00000000-0000-0000-0000-000000000000'
  WHERE user_id = p_user_id;

  -- auth.users deletion handled by Supabase Auth (separate admin call)
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

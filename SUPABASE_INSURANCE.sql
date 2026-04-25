-- ============================================================
-- BTLR Home Insurance Table
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS home_insurance (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id         bigint      NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  -- Provider & Policy
  provider            text,
  policy_number       text,
  policy_type         text,        -- HO-3, HO-5, HO-6, etc.
  agent_name          text,
  agent_phone         text,
  agent_email         text,

  -- Coverage amounts
  dwelling_coverage   numeric,     -- Coverage A
  other_structures    numeric,     -- Coverage B
  personal_property   numeric,     -- Coverage C
  loss_of_use         numeric,     -- Coverage D
  liability_coverage  numeric,     -- Coverage E
  medical_payments    numeric,     -- Coverage F

  -- Deductibles
  deductible_standard numeric,
  deductible_wind     numeric,     -- separate wind/hail deductible
  deductible_hurricane numeric,

  -- Premium & Payment
  annual_premium      numeric,
  payment_amount      numeric,
  payment_frequency   text,        -- monthly | annual | semi-annual
  payment_due_date    integer,     -- day of month if monthly
  payment_method      text,        -- e.g. "escrow" | "direct"

  -- Dates
  effective_date      date,
  expiration_date     date,
  auto_renews         boolean,

  -- What's covered / excluded
  coverage_items      text[]   NOT NULL DEFAULT '{}',
  exclusions          text[]   NOT NULL DEFAULT '{}',
  endorsements        text[]   NOT NULL DEFAULT '{}',  -- riders / add-ons
  -- e.g. ["Flood (separate)", "Jewelry rider", "Home office"]

  -- Replacement cost vs ACV
  replacement_cost_dwelling   boolean,  -- true = RCV, false = ACV
  replacement_cost_contents   boolean,

  -- Claims contact
  claim_phone         text,
  claim_url           text,
  claim_email         text,
  claim_hours         text,        -- e.g. "24/7" or "M-F 8am-5pm"

  -- Meta
  parsed_at           timestamptz,
  file_path           text,        -- storage path of source document

  CONSTRAINT home_insurance_user_property UNIQUE (user_id, property_id)
);

ALTER TABLE home_insurance ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_hi_user     ON home_insurance (user_id);
CREATE INDEX IF NOT EXISTS idx_hi_property ON home_insurance (property_id);
CREATE INDEX IF NOT EXISTS idx_hi_expiry   ON home_insurance (expiration_date);

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users view own insurance"   ON home_insurance;
  DROP POLICY IF EXISTS "Users insert own insurance" ON home_insurance;
  DROP POLICY IF EXISTS "Users update own insurance" ON home_insurance;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users view own insurance"   ON home_insurance FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "Users insert own insurance" ON home_insurance FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own insurance" ON home_insurance FOR UPDATE
  USING (user_id = auth.uid());

CREATE OR REPLACE TRIGGER home_insurance_updated_at
  BEFORE UPDATE ON home_insurance
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

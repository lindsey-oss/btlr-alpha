-- ============================================================
-- BTLR Home Warranties Table
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS home_warranties (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  user_id             uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  property_id         bigint      NOT NULL REFERENCES properties(id) ON DELETE CASCADE,

  -- Provider & Plan
  provider            text,
  plan_name           text,
  policy_number       text,

  -- Cost per claim
  service_fee         numeric,

  -- What's covered / excluded
  coverage_items      text[]   NOT NULL DEFAULT '{}',
  exclusions          text[]   NOT NULL DEFAULT '{}',
  coverage_limits     jsonb    DEFAULT '{}'::jsonb,
  -- e.g. {"HVAC": 2000, "Roof leak": 500}

  -- Dates
  effective_date      date,
  expiration_date     date,
  auto_renews         boolean,

  -- Payment
  payment_amount      numeric,
  payment_frequency   text,    -- monthly | annual
  payment_due_date    integer, -- day of month

  -- Claim contact info
  claim_phone         text,
  claim_url           text,
  claim_email         text,

  -- Service terms
  waiting_period      text,    -- e.g. "30 days"
  response_time       text,    -- e.g. "24 hours"
  max_annual_benefit  numeric,

  -- Meta
  parsed_at           timestamptz,
  file_path           text,    -- storage path of source document

  CONSTRAINT home_warranties_user_property UNIQUE (user_id, property_id)
);

ALTER TABLE home_warranties ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_hw_user     ON home_warranties (user_id);
CREATE INDEX IF NOT EXISTS idx_hw_property ON home_warranties (property_id);
CREATE INDEX IF NOT EXISTS idx_hw_expiry   ON home_warranties (expiration_date);

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users view own warranty"   ON home_warranties;
  DROP POLICY IF EXISTS "Users insert own warranty" ON home_warranties;
  DROP POLICY IF EXISTS "Users update own warranty" ON home_warranties;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users view own warranty"   ON home_warranties FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "Users insert own warranty" ON home_warranties FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own warranty" ON home_warranties FOR UPDATE
  USING (user_id = auth.uid());

CREATE OR REPLACE TRIGGER home_warranties_updated_at
  BEFORE UPDATE ON home_warranties
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

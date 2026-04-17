-- Run in Supabase SQL Editor → New Query
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS mortgage_lender      TEXT,
  ADD COLUMN IF NOT EXISTS mortgage_balance     NUMERIC,
  ADD COLUMN IF NOT EXISTS mortgage_payment     NUMERIC,
  ADD COLUMN IF NOT EXISTS mortgage_due_day     INTEGER,
  ADD COLUMN IF NOT EXISTS mortgage_rate        NUMERIC,
  ADD COLUMN IF NOT EXISTS mortgage_updated_at  TIMESTAMPTZ;

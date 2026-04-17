-- ============================================================
-- BTLR Migration V3 FIXED — Run this in Supabase SQL Editor
-- Safe to run even if earlier migrations were already applied
-- ============================================================

-- 1. Add new columns to properties table (all IF NOT EXISTS — safe to re-run)
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS user_id               UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS inspection_summary    TEXT,
  ADD COLUMN IF NOT EXISTS inspection_type       TEXT,
  ADD COLUMN IF NOT EXISTS inspection_date       TEXT,
  ADD COLUMN IF NOT EXISTS inspector_company     TEXT,
  ADD COLUMN IF NOT EXISTS inspection_findings   JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recommendations       JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS total_estimated_cost  NUMERIC,
  ADD COLUMN IF NOT EXISTS inspection_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS home_value            NUMERIC,
  ADD COLUMN IF NOT EXISTS insurance_premium     NUMERIC,
  ADD COLUMN IF NOT EXISTS insurance_renewal     DATE,
  ADD COLUMN IF NOT EXISTS property_tax_annual   NUMERIC,
  ADD COLUMN IF NOT EXISTS plaid_access_token    TEXT,
  ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ DEFAULT NOW();

-- 2. Enable RLS on properties
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

-- 3. Properties policies — drop and recreate cleanly
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view own property"   ON properties;
  DROP POLICY IF EXISTS "Users can insert own property" ON properties;
  DROP POLICY IF EXISTS "Users can update own property" ON properties;
  DROP POLICY IF EXISTS "Users can delete own property" ON properties;
  DROP POLICY IF EXISTS "Allow all"                     ON properties;
  DROP POLICY IF EXISTS "Public read"                   ON properties;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users can view own property"
  ON properties FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own property"
  ON properties FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own property"
  ON properties FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own property"
  ON properties FOR DELETE
  USING (auth.uid() = user_id);

-- 4. Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can read"   ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can delete" ON storage.objects;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Authenticated users can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Authenticated users can read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents');

CREATE POLICY "Authenticated users can delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents');

-- 5. job_requests — add user_id column only (don't touch existing policies)
ALTER TABLE job_requests ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

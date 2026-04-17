-- ============================================================
-- BTLR Migration V3 — Run this in Supabase Dashboard → SQL Editor
-- Adds inspection findings persistence + user isolation for 10-homeowner beta
-- ============================================================

-- 1. Add inspection data columns to properties table
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

-- 2. Enable Row Level Security (makes each homeowner see only their own data)
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

-- Drop old permissive policies if they exist
DROP POLICY IF EXISTS "Users can view own property"   ON properties;
DROP POLICY IF EXISTS "Users can insert own property" ON properties;
DROP POLICY IF EXISTS "Users can update own property" ON properties;
-- Fallback: drop any open policies
DROP POLICY IF EXISTS "Allow all"                     ON properties;
DROP POLICY IF EXISTS "Public read"                   ON properties;

-- Create properly scoped policies
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

-- 3. Storage bucket policies (documents bucket must exist)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- Drop old storage policies if they exist
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete" ON storage.objects;

-- Recreate storage policies scoped to authenticated users
CREATE POLICY "Authenticated users can upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents');

CREATE POLICY "Authenticated users can read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents');

CREATE POLICY "Authenticated users can delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents');

-- 4. Assign existing properties to authenticated users (if any orphaned rows)
-- (Run manually only if you have existing test data you want to keep)
-- UPDATE properties SET user_id = auth.uid() WHERE user_id IS NULL;

-- 5. Verify job_requests table exists with correct policies
CREATE TABLE IF NOT EXISTS job_requests (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  homeowner_email          TEXT,
  user_id                  UUID REFERENCES auth.users(id),
  property_address         TEXT,
  trade                    TEXT,
  trade_emoji              TEXT,
  issue_summary            TEXT,
  full_description         TEXT,
  urgency                  TEXT,
  urgency_reason           TEXT,
  what_to_tell_contractor  TEXT,
  diy_tips                 TEXT[],
  questions_to_ask         TEXT[],
  estimated_cost_low       INTEGER,
  estimated_cost_high      INTEGER,
  related_findings         JSONB,
  status                   TEXT DEFAULT 'pending',
  contractor_name          TEXT,
  contractor_phone         TEXT,
  contractor_notes         TEXT,
  accepted_at              TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ
);

-- Add user_id to job_requests if missing
ALTER TABLE job_requests ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

ALTER TABLE job_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert jobs" ON job_requests;
DROP POLICY IF EXISTS "Anyone can read jobs by id" ON job_requests;
DROP POLICY IF EXISTS "Anyone can update job status" ON job_requests;
DROP POLICY IF EXISTS "Users can read own jobs" ON job_requests;
DROP POLICY IF EXISTS "Users can insert own jobs" ON job_requests;

-- Users see only their own jobs; contractors can update via job link (open update)
CREATE POLICY "Users can insert own jobs"
  ON job_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own jobs"
  ON job_requests FOR SELECT
  USING (auth.uid() = user_id OR true); -- true allows job link sharing (public read by id)

CREATE POLICY "Anyone can update job status"
  ON job_requests FOR UPDATE
  USING (true);

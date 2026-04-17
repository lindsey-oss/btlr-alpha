-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New Query)
-- It adds the columns needed for Phase 2 features

-- Add Plaid access token storage to properties table
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS plaid_access_token TEXT,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS home_value NUMERIC,
  ADD COLUMN IF NOT EXISTS insurance_premium NUMERIC,
  ADD COLUMN IF NOT EXISTS insurance_renewal DATE,
  ADD COLUMN IF NOT EXISTS property_tax_annual NUMERIC,
  ADD COLUMN IF NOT EXISTS property_tax_due DATE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Enable Row Level Security so each user only sees their own data
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own property"
  ON properties FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own property"
  ON properties FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own property"
  ON properties FOR UPDATE
  USING (auth.uid() = user_id);

-- Make sure the documents bucket exists and is public
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- BTLR Score Persistence Fix
-- Run this ONCE in Supabase SQL Editor
--
-- Problem: inspection_findings and finding_statuses weren't
-- always saving correctly because there was no safe upsert
-- path — the app had to guess whether to INSERT or UPDATE.
--
-- Fix: add a UNIQUE constraint on user_id in properties so
-- the app can use upsert(onConflict: "user_id") — one atomic
-- operation with no race conditions.
-- ============================================================

-- Step 1: Remove duplicate property rows per user (keep newest)
DELETE FROM properties
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id) id
  FROM properties
  WHERE user_id IS NOT NULL
  ORDER BY user_id, updated_at DESC NULLS LAST
)
AND user_id IS NOT NULL;

-- Step 2: Add unique constraint on user_id
-- (safe to re-run — IF NOT EXISTS on the index)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'properties_user_id_unique'
  ) THEN
    ALTER TABLE properties
      ADD CONSTRAINT properties_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- Step 3: Ensure all required columns exist (safe to re-run)
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS inspection_findings    JSONB        DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS inspection_type        TEXT,
  ADD COLUMN IF NOT EXISTS inspection_summary     TEXT,
  ADD COLUMN IF NOT EXISTS recommendations        JSONB        DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS total_estimated_cost   NUMERIC,
  ADD COLUMN IF NOT EXISTS inspection_date        TEXT,
  ADD COLUMN IF NOT EXISTS inspector_company      TEXT,
  ADD COLUMN IF NOT EXISTS finding_statuses       JSONB        DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS roof_year              INTEGER,
  ADD COLUMN IF NOT EXISTS hvac_year              INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ  DEFAULT NOW();

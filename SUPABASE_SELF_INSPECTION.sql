-- ============================================================
-- BTLR: Self-Inspection & Verified Badge Support
-- Run in Supabase SQL Editor
--
-- Adds:
--   1. finding_source column on findings — distinguishes
--      'professional' | 'self_inspection' rows
--   2. inspection_source column on properties — drives
--      "Professionally Verified" badge eligibility
--   3. user_profiles table — stores tier ('free' | 'pro')
--      and is the single source of truth for plan gating
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. findings.finding_source
--    Allows filtering and clearing self-inspection rows
--    independently from professional inspection rows.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.findings
  ADD COLUMN IF NOT EXISTS finding_source TEXT NOT NULL DEFAULT 'professional'
  CHECK (finding_source IN ('professional', 'self_inspection', 'photo'));

-- Backfill: existing rows are professional inspection findings
UPDATE public.findings
  SET finding_source = 'professional'
  WHERE finding_source IS NULL OR finding_source = 'professional';

CREATE INDEX IF NOT EXISTS findings_source_idx
  ON public.findings (finding_source);


-- ────────────────────────────────────────────────────────────
-- 2. properties.inspection_source
--    'professional' → badge-eligible when PRO + decay Fresh/Current
--    'self'         → self-inspection, no badge
--    NULL           → no inspection data yet
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS inspection_source TEXT DEFAULT 'professional'
  CHECK (inspection_source IN ('professional', 'self', NULL));

-- Backfill existing properties that already have inspection data
UPDATE public.properties
  SET inspection_source = 'professional'
  WHERE inspection_source IS NULL
    AND (inspection_findings IS NOT NULL
         OR inspection_type  IS NOT NULL);


-- ────────────────────────────────────────────────────────────
-- 3. user_profiles
--    One row per authenticated user. Auto-created on first login
--    via the trigger below. Tier defaults to 'free'.
--
--    tier values:
--      'free' — standard access, guided self-inspection only
--      'pro'  — can upload professional inspection reports,
--               earns "Professionally Verified" badge
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier        TEXT        NOT NULL DEFAULT 'free'
                          CHECK (tier IN ('free', 'pro')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users view own profile"   ON public.user_profiles;
  DROP POLICY IF EXISTS "Users update own profile" ON public.user_profiles;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users view own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users update own profile"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = id);

-- Auto-create profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, tier)
  VALUES (NEW.id, 'free')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill profiles for any existing users missing a row
INSERT INTO public.user_profiles (id, tier)
  SELECT id, 'free'
  FROM auth.users
  ON CONFLICT (id) DO NOTHING;

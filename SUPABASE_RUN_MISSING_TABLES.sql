-- ============================================================
-- BTLR — Missing Tables (run once in Supabase SQL Editor)
-- Fixes 404 errors on: user_profiles, saved_contacts, repair_documents
-- All statements are safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING)
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- PART 1: user_profiles
-- One row per user. Auto-created on signup. Drives free/pro tier gating.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.findings
  ADD COLUMN IF NOT EXISTS finding_source TEXT NOT NULL DEFAULT 'professional'
  CHECK (finding_source IN ('professional', 'self_inspection', 'photo'));

UPDATE public.findings
  SET finding_source = 'professional'
  WHERE finding_source IS NULL OR finding_source = 'professional';

CREATE INDEX IF NOT EXISTS findings_source_idx
  ON public.findings (finding_source);

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS inspection_source TEXT DEFAULT 'professional'
  CHECK (inspection_source IN ('professional', 'self', NULL));

UPDATE public.properties
  SET inspection_source = 'professional'
  WHERE inspection_source IS NULL
    AND (inspection_findings IS NOT NULL
         OR inspection_type  IS NOT NULL);

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

-- Backfill for existing users
INSERT INTO public.user_profiles (id, tier)
  SELECT id, 'free'
  FROM auth.users
  ON CONFLICT (id) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- PART 2: affiliates + saved_contacts + affiliate_referrals
-- Drives the Vendors tab "My Team" saved contacts and affiliate link flow.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS affiliates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL,
  name        text NOT NULL,
  company     text,
  role        text NOT NULL,
  phone       text,
  email       text,
  photo_url   text,
  bio         text,
  website     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  affiliate_id  uuid REFERENCES affiliates(id) ON DELETE SET NULL,
  name          text NOT NULL,
  company       text,
  role          text NOT NULL,
  category      text NOT NULL,
  phone         text,
  email         text,
  website       text,
  photo_url     text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (user_id, affiliate_id)
);

CREATE TABLE IF NOT EXISTS affiliate_referrals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id  uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, user_id)
);

ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Public read active affiliates" ON affiliates;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Public read active affiliates"
  ON affiliates FOR SELECT
  USING (is_active = true);

ALTER TABLE saved_contacts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users manage own saved contacts" ON saved_contacts;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE POLICY "Users manage own saved contacts"
  ON saved_contacts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE affiliate_referrals ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_affiliates_code        ON affiliates(code);
CREATE INDEX IF NOT EXISTS idx_saved_contacts_user    ON saved_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_affiliate    ON affiliate_referrals(affiliate_id);


-- ────────────────────────────────────────────────────────────
-- PART 3: repair_documents
-- Stores parsed repair invoices/receipts uploaded by homeowners.
-- ────────────────────────────────────────────────────────────

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS finding_statuses JSONB NOT NULL DEFAULT '{}';

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS findings_reviewed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS repair_documents (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           BIGINT  REFERENCES properties(id) ON DELETE CASCADE,
  user_id               UUID    REFERENCES auth.users(id) ON DELETE CASCADE,
  filename              TEXT,
  storage_path          TEXT,
  vendor_name           TEXT,
  service_date          TEXT,
  repair_summary        TEXT,
  system_category       TEXT,
  cost                  NUMERIC,
  is_completed          BOOLEAN DEFAULT TRUE,
  warranty_period       TEXT,
  line_items            JSONB DEFAULT '[]',
  resolved_finding_keys TEXT[] DEFAULT '{}',
  raw_text_preview      TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE repair_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can read own repair documents"   ON repair_documents;
  DROP POLICY IF EXISTS "Users can insert own repair documents" ON repair_documents;
  DROP POLICY IF EXISTS "Users can update own repair documents" ON repair_documents;
  DROP POLICY IF EXISTS "Users can delete own repair documents" ON repair_documents;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users can read own repair documents"
  ON repair_documents FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own repair documents"
  ON repair_documents FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own repair documents"
  ON repair_documents FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own repair documents"
  ON repair_documents FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS repair_documents_property_id_idx ON repair_documents (property_id);
CREATE INDEX IF NOT EXISTS repair_documents_user_id_idx     ON repair_documents (user_id);

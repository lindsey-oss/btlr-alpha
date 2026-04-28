-- ─────────────────────────────────────────────────────────────────────────────
-- BTLR Affiliate System
-- Creates affiliates, saved_contacts, and affiliate_referrals tables.
-- Run this migration in your Supabase SQL editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── affiliates ────────────────────────────────────────────────────────────────
-- Real estate professionals who refer homeowners via unique links.
CREATE TABLE IF NOT EXISTS affiliates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text UNIQUE NOT NULL,           -- URL-safe slug, e.g. "jsmith-realtor"
  name        text NOT NULL,
  company     text,
  role        text NOT NULL,                  -- 'realtor' | 'lender' | 'escrow' | 'title' | 'attorney'
  phone       text,
  email       text,
  photo_url   text,
  bio         text,
  website     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── saved_contacts ────────────────────────────────────────────────────────────
-- Homeowner's personal vendor/team directory. One row per saved contact.
-- affiliate_id is set when the contact was auto-populated from an affiliate link.
CREATE TABLE IF NOT EXISTS saved_contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  affiliate_id  uuid REFERENCES affiliates(id) ON DELETE SET NULL,
  name          text NOT NULL,
  company       text,
  role          text NOT NULL,   -- e.g. 'realtor' | 'lender' | 'escrow' | 'plumber' | 'landscaper' …
  category      text NOT NULL,   -- 'real_estate' | 'insurance' | 'maintenance' | 'repair'
  phone         text,
  email         text,
  website       text,
  photo_url     text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Prevent duplicate auto-population from the same affiliate link
  UNIQUE NULLS NOT DISTINCT (user_id, affiliate_id)
);

-- ── affiliate_referrals ───────────────────────────────────────────────────────
-- Audit log: which homeowner signed up via which affiliate.
CREATE TABLE IF NOT EXISTS affiliate_referrals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id  uuid NOT NULL REFERENCES affiliates(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (affiliate_id, user_id)
);

-- ── RLS policies ──────────────────────────────────────────────────────────────

-- affiliates: public read of active affiliates (needed for the landing page)
ALTER TABLE affiliates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read active affiliates"
  ON affiliates FOR SELECT
  USING (is_active = true);

-- saved_contacts: users can CRUD only their own rows
ALTER TABLE saved_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own saved contacts"
  ON saved_contacts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- affiliate_referrals: service role only (written server-side)
ALTER TABLE affiliate_referrals ENABLE ROW LEVEL SECURITY;
-- No public policies — all writes go through service-role API routes.

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_affiliates_code        ON affiliates(code);
CREATE INDEX IF NOT EXISTS idx_saved_contacts_user    ON saved_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_affiliate    ON affiliate_referrals(affiliate_id);

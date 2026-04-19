-- ============================================================
-- BTLR Repairs Hotfix — Run this in Supabase SQL Editor
-- Creates the repair_documents table so repair history
-- persists across sessions and updates the health score.
-- ============================================================

CREATE TABLE IF NOT EXISTS repair_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  property_id           UUID REFERENCES properties(id) ON DELETE CASCADE,
  user_id               UUID REFERENCES auth.users(id),
  filename              TEXT,
  vendor_name           TEXT,
  service_date          TEXT,
  repair_summary        TEXT,
  system_category       TEXT,
  cost                  NUMERIC,
  is_completed          BOOLEAN DEFAULT true,
  warranty_period       TEXT,
  line_items            JSONB DEFAULT '[]'::jsonb,
  resolved_finding_keys JSONB DEFAULT '[]'::jsonb,
  raw_text_preview      TEXT
);

ALTER TABLE repair_documents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view own repair docs"   ON repair_documents;
  DROP POLICY IF EXISTS "Users can insert own repair docs" ON repair_documents;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users can view own repair docs"
  ON repair_documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own repair docs"
  ON repair_documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

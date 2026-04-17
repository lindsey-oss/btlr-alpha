-- ============================================================
-- BTLR Repair Lifecycle Migration
-- Run in Supabase SQL Editor
-- April 2026
-- ============================================================

-- 1. Add finding_statuses to properties table
--    Stores { [categoryKey]: 'open' | 'completed' | 'monitored' | 'not_sure' | 'dismissed' }
--    Category key = lowercased, alphanum-only version of finding.category
--    e.g. "Electrical Panel" → "electricalpanel"
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS finding_statuses JSONB NOT NULL DEFAULT '{}';

-- 2. Add repair review tracking to properties
--    Tracks whether user has reviewed findings post-upload
ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS findings_reviewed_at TIMESTAMPTZ;

-- 3. Create repair_documents table
--    Stores parsed repair invoices, receipts, contractor reports
CREATE TABLE IF NOT EXISTS repair_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           UUID REFERENCES properties(id) ON DELETE CASCADE,
  user_id               UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Source file info
  filename              TEXT,
  storage_path          TEXT,

  -- Parsed fields
  vendor_name           TEXT,
  service_date          TEXT,
  repair_summary        TEXT,
  system_category       TEXT,         -- e.g. 'Roof', 'HVAC', 'Electrical'
  cost                  NUMERIC,
  is_completed          BOOLEAN DEFAULT TRUE,
  warranty_period       TEXT,
  line_items            JSONB DEFAULT '[]',  -- array of work item strings

  -- Finding linkage
  -- Array of category keys this repair resolves (matches finding_statuses keys)
  resolved_finding_keys TEXT[] DEFAULT '{}',

  -- Raw extracted text for debugging
  raw_text_preview      TEXT,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Row-Level Security on repair_documents
ALTER TABLE repair_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own repair documents"
  ON repair_documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own repair documents"
  ON repair_documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own repair documents"
  ON repair_documents FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own repair documents"
  ON repair_documents FOR DELETE
  USING (auth.uid() = user_id);

-- 5. Index for fast lookups
CREATE INDEX IF NOT EXISTS repair_documents_property_id_idx
  ON repair_documents (property_id);

CREATE INDEX IF NOT EXISTS repair_documents_user_id_idx
  ON repair_documents (user_id);

-- ============================================================
-- HOW FINDING STATUSES WORK
-- ============================================================
-- finding_statuses is a JSONB object on the properties row:
--
-- {
--   "electrical":     "completed",   ← user confirmed or repair doc matched
--   "roof":           "open",        ← still needs attention
--   "hvac":           "not_sure",    ← user isn't sure
--   "foundation":     "monitored",   ← watching but not urgent
--   "windowseal":     "dismissed"    ← user considers N/A
-- }
--
-- Category key formula:
--   finding.category.toLowerCase().replace(/[^a-z0-9]/g, '')
--
-- Health score only counts findings with status:
--   'open', 'not_sure', or absent (undefined = open by default)
--
-- Completed/dismissed findings are excluded from:
--   - Health score deductions
--   - Upcoming cost projections
--   - Repair recommendations
--
-- ============================================================
-- EXAMPLE: Update a finding status from the dashboard
-- ============================================================
-- UPDATE properties
-- SET finding_statuses = finding_statuses || '{"electrical": "completed"}'::jsonb,
--     updated_at = NOW()
-- WHERE id = '<property_id>';
--
-- ============================================================
-- EXAMPLE: Link a repair document to resolved findings
-- ============================================================
-- UPDATE repair_documents
-- SET resolved_finding_keys = ARRAY['electrical', 'outlet'],
--     updated_at = NOW()
-- WHERE id = '<repair_doc_id>';
-- ============================================================

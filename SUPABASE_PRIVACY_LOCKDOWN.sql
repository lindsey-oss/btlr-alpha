-- ============================================================
-- BTLR Privacy Lockdown — Run in Supabase SQL Editor
--
-- Fixes:
--   1. Properties RLS — removes "OR user_id IS NULL" hole that let
--      new users see other users' properties
--   2. Documents storage bucket — set to private (was public)
--   3. Storage policies — user-scoped path-based policies for docs
--   4. Tightens any remaining open policies
--
-- Safe to re-run — drops existing policies before recreating.
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 1. PROPERTIES TABLE — strict user_id-only policies
--    Removes the "OR user_id IS NULL" introduced by RLS hotfix
-- ════════════════════════════════════════════════════════════

-- Drop all variants of these policies (handles multiple migration histories)
DROP POLICY IF EXISTS "Users can view own property"   ON properties;
DROP POLICY IF EXISTS "Users can insert own property" ON properties;
DROP POLICY IF EXISTS "Users can update own property" ON properties;
DROP POLICY IF EXISTS "Users can delete own property" ON properties;

-- Strict user-only policies — no NULL bypass
CREATE POLICY "Users can view own property"
  ON properties FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own property"
  ON properties FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own property"
  ON properties FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own property"
  ON properties FOR DELETE
  USING (auth.uid() = user_id);

-- Make sure RLS is actually enabled
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════
-- 2. DOCUMENTS STORAGE BUCKET — make private
--    Bucket created public in early migration; set to private.
-- ════════════════════════════════════════════════════════════

-- Create bucket if it doesn't exist (private from the start)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  20971520,  -- 20MB
  ARRAY['application/pdf', 'text/plain', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET public = false;


-- ════════════════════════════════════════════════════════════
-- 3. DOCUMENTS STORAGE POLICIES — path-based user isolation
--    Files stored at {user_id}/docs-{ts}-{filename}
--    Only the owning user can read/write their subfolder.
-- ════════════════════════════════════════════════════════════

-- Drop all existing documents bucket policies
DROP POLICY IF EXISTS "Users can view own documents"   ON storage.objects;
DROP POLICY IF EXISTS "Users can upload documents"     ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own documents" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete" ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads"           ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads"    ON storage.objects;

-- SELECT: users can only read files in their own subfolder
CREATE POLICY "Users can view own documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- INSERT: users can only upload into their own subfolder
CREATE POLICY "Users can upload documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: users can only delete their own files
CREATE POLICY "Users can delete own documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: users can only overwrite their own files
CREATE POLICY "Users can update own documents"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ════════════════════════════════════════════════════════════
-- 4. INSPECTIONS STORAGE BUCKET — ensure private + policies
--    (Mirrors SUPABASE_INSPECTIONS_BUCKET.sql but idempotent)
-- ════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'inspections',
  'inspections',
  false,
  20971520,
  ARRAY['application/pdf', 'text/plain']
)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Drop all existing inspections bucket policies
DROP POLICY IF EXISTS "Users can upload inspections"      ON storage.objects;
DROP POLICY IF EXISTS "Users can view own inspections"    ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own inspections"  ON storage.objects;
DROP POLICY IF EXISTS "Users can update own inspections"  ON storage.objects;
DROP POLICY IF EXISTS "Owner upload"                      ON storage.objects;
DROP POLICY IF EXISTS "Owner read"                        ON storage.objects;
DROP POLICY IF EXISTS "Owner delete"                      ON storage.objects;
DROP POLICY IF EXISTS "Owner update"                      ON storage.objects;

CREATE POLICY "Users can upload inspections"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'inspections'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can view own inspections"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'inspections'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can delete own inspections"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'inspections'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users can update own inspections"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'inspections'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );


-- ════════════════════════════════════════════════════════════
-- 5. VERIFY other tables have RLS enabled
--    (belt-and-suspenders for tables added incrementally)
-- ════════════════════════════════════════════════════════════

ALTER TABLE home_insurance  ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_requests    ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════
-- 6. REPAIR DOCUMENTS — if table exists, ensure user-scoped
-- ════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'repair_documents'
  ) THEN
    EXECUTE 'ALTER TABLE repair_documents ENABLE ROW LEVEL SECURITY';

    -- Drop and recreate scoped policies
    EXECUTE 'DROP POLICY IF EXISTS "Users view own repair docs" ON repair_documents';
    EXECUTE 'DROP POLICY IF EXISTS "Users insert own repair docs" ON repair_documents';
    EXECUTE 'DROP POLICY IF EXISTS "Users delete own repair docs" ON repair_documents';

    EXECUTE $pol$
      CREATE POLICY "Users view own repair docs" ON repair_documents
        FOR SELECT USING (
          property_id IN (SELECT id FROM properties WHERE user_id = auth.uid())
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY "Users insert own repair docs" ON repair_documents
        FOR INSERT WITH CHECK (
          property_id IN (SELECT id FROM properties WHERE user_id = auth.uid())
        )
    $pol$;

    EXECUTE $pol$
      CREATE POLICY "Users delete own repair docs" ON repair_documents
        FOR DELETE USING (
          property_id IN (SELECT id FROM properties WHERE user_id = auth.uid())
        )
    $pol$;
  END IF;
END $$;

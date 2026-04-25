-- ============================================================
-- BTLR Inspections Bucket — Storage Policies
-- Run in Supabase SQL Editor
--
-- Bucket settings (set manually in Storage tab):
--   Name: inspections
--   Public: OFF
--   File size limit: 20MB
--   Allowed MIME types: application/pdf, text/plain
--
-- Safe to re-run — drops existing policies before recreating.
-- ============================================================

-- Drop any existing policies for this bucket (prevents "already exists" errors)
DROP POLICY IF EXISTS "Owner upload"                      ON storage.objects;
DROP POLICY IF EXISTS "Owner read"                        ON storage.objects;
DROP POLICY IF EXISTS "Owner delete"                      ON storage.objects;
DROP POLICY IF EXISTS "Owner update"                      ON storage.objects;
DROP POLICY IF EXISTS "Users can upload inspections"      ON storage.objects;
DROP POLICY IF EXISTS "Users can view own inspections"    ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own inspections"  ON storage.objects;
DROP POLICY IF EXISTS "Users can update own inspections"  ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads"       ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads"              ON storage.objects;

-- INSERT: authenticated users can upload into their own subfolder only
CREATE POLICY "Users can upload inspections"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'inspections'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- SELECT: users can read/download only their own files
CREATE POLICY "Users can view own inspections"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'inspections'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: users can delete only their own files
CREATE POLICY "Users can delete own inspections"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'inspections'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: users can overwrite their own files
CREATE POLICY "Users can update own inspections"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'inspections'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- BTLR Docs Storage Hotfix v3 — Run this in Supabase SQL Editor
--
-- Root cause: uploads were going to bucket root with no user prefix.
-- The owner/owner_id column comparison was unreliable.
--
-- Fix: docs are now stored at {user_id}/docs-{ts}-{name}.
-- RLS uses path-based auth (storage.foldername) which is bulletproof —
-- no dependency on owner or owner_id columns.
-- ============================================================

DROP POLICY IF EXISTS "Users can view own documents"   ON storage.objects;
DROP POLICY IF EXISTS "Users can upload documents"     ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow public uploads"           ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads"    ON storage.objects;

-- SELECT: users can list/download files in their own subfolder
CREATE POLICY "Users can view own documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- INSERT: users can upload into their own subfolder only
CREATE POLICY "Users can upload documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: users can delete their own files
CREATE POLICY "Users can delete own documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: users can overwrite their own files
CREATE POLICY "Users can update own documents"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

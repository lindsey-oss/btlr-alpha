-- ============================================================
-- BTLR Docs Storage Hotfix — Run this in Supabase SQL Editor
--
-- Root cause: the `documents` bucket had no SELECT RLS policy.
-- supabase.storage.list("") returns { data: [], error: null }
-- (empty array — not an error) so loadDocs() always shows
-- nothing after page refresh, even though files exist in storage.
--
-- Fix: add SELECT, INSERT, and DELETE policies scoped to the
-- file's owner so each user only sees their own documents.
-- ============================================================

-- ── Drop any conflicting existing policies ─────────────────
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view own documents"   ON storage.objects;
  DROP POLICY IF EXISTS "Users can upload documents"     ON storage.objects;
  DROP POLICY IF EXISTS "Users can delete own documents" ON storage.objects;
  DROP POLICY IF EXISTS "Users can update own documents" ON storage.objects;
  DROP POLICY IF EXISTS "Allow public uploads"           ON storage.objects;
  DROP POLICY IF EXISTS "Allow authenticated uploads"    ON storage.objects;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ── SELECT: list and download own files ────────────────────
-- auth.uid() = owner  →  each user sees only files they uploaded.
-- Supabase sets `owner` automatically to auth.uid() on insert.
CREATE POLICY "Users can view own documents"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'documents'
    AND auth.uid() = owner
  );

-- ── INSERT: authenticated users can upload ─────────────────
CREATE POLICY "Users can upload documents"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'documents'
    AND auth.role() = 'authenticated'
  );

-- ── DELETE: users can remove their own files ───────────────
CREATE POLICY "Users can delete own documents"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'documents'
    AND auth.uid() = owner
  );

-- ── UPDATE: users can overwrite (upsert) own files ─────────
CREATE POLICY "Users can update own documents"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'documents'
    AND auth.uid() = owner
  );

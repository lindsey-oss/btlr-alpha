-- ============================================================
-- BTLR: Add UPDATE policy to documents table
--
-- The original documents_table.sql migration only added INSERT,
-- SELECT, and DELETE policies. Without an UPDATE policy, any
-- upsert with onConflict on storage_path would silently fail
-- for authenticated users. This migration adds the missing policy.
--
-- Safe to re-run (CREATE POLICY IF NOT EXISTS).
-- ============================================================

CREATE POLICY IF NOT EXISTS "users update own documents"
  ON public.documents FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

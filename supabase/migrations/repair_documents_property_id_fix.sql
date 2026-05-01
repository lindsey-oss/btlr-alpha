-- ============================================================
-- Fix: repair_documents.property_id type mismatch
--
-- The original repair_lifecycle.sql defined property_id as UUID,
-- but properties.id is BIGINT (Supabase default integer PK).
-- This migration corrects the type to match.
--
-- Safe to run multiple times (IF EXISTS guards on constraint drop).
-- ============================================================

-- 1. Drop the existing FK constraint if it exists
ALTER TABLE public.repair_documents
  DROP CONSTRAINT IF EXISTS repair_documents_property_id_fkey;

-- 2. Change column type from UUID to BIGINT
--    USING casts existing values — safe if column is empty or all NULL
ALTER TABLE public.repair_documents
  ALTER COLUMN property_id TYPE BIGINT
  USING property_id::TEXT::BIGINT;

-- 3. Re-add FK constraint pointing to properties.id (BIGINT)
ALTER TABLE public.repair_documents
  ADD CONSTRAINT repair_documents_property_id_fkey
  FOREIGN KEY (property_id) REFERENCES public.properties(id) ON DELETE CASCADE;

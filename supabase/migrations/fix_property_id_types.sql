-- ============================================================
-- BTLR: fix_property_id_types
-- Corrects property_id columns from UUID to BIGINT to match
-- the actual properties.id type (integer/bigint), which was
-- causing silent insert failures in documents and
-- repair_completions tables.
-- ============================================================

-- documents table
ALTER TABLE public.documents
  ALTER COLUMN property_id TYPE bigint
  USING NULL;   -- existing rows get NULL (safe: column was always nullable)

-- repair_completions table
ALTER TABLE public.repair_completions
  ALTER COLUMN property_id TYPE bigint
  USING NULL;

-- Confirm
COMMENT ON COLUMN public.documents.property_id        IS 'bigint — matches properties.id';
COMMENT ON COLUMN public.repair_completions.property_id IS 'bigint — matches properties.id';

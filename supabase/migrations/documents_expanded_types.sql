-- ============================================================
-- BTLR: Expand document_type values
-- Adds permit, manual, deed as valid types.
-- No constraint change needed — document_type is plain TEXT.
-- This migration is documentation only; run it to record the intent.
-- ============================================================

-- Supported document_type values (updated 2026-05-04):
-- 'inspection'  — Home inspection reports
-- 'insurance'   — Home insurance policies
-- 'warranty'    — Appliance and system warranties
-- 'repair'      — Repair receipts and invoices
-- 'permit'      — Building and renovation permits (NEW)
-- 'manual'      — Appliance and system manuals (NEW)
-- 'deed'        — Property deed and ownership documents (NEW)
-- 'other'       — Catch-all for unclassified documents

-- No schema change needed — document_type TEXT has no CHECK constraint.
-- This comment block is the source of truth for valid type values.

COMMENT ON COLUMN public.documents.document_type IS
  'Valid values: inspection | insurance | warranty | repair | permit | manual | deed | other';

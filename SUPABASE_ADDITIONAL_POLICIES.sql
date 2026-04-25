-- ============================================================
-- BTLR Additional Insurance Policies
-- Adds support for a second (or third) insurance policy per property.
-- Common use case: CA FAIR Plan + DIC policy stacked together.
--
-- Safe to run multiple times (idempotent).
-- ============================================================

ALTER TABLE home_insurance
  ADD COLUMN IF NOT EXISTS additional_policies JSONB DEFAULT '[]'::jsonb;

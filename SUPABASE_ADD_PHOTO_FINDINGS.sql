-- ============================================================
-- BTLR Photo Findings Migration
-- Run this ONCE in Supabase SQL Editor
--
-- Adds photo_findings column so photo-based analysis persists
-- alongside inspection report findings. Both are combined when
-- computing the Home Health Score.
-- ============================================================

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS photo_findings JSONB DEFAULT '[]'::jsonb;

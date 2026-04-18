-- ============================================================
-- BTLR Notification Hotfix — Run this in Supabase SQL Editor
-- Adds declined_at timestamp column to job_requests
-- ============================================================

ALTER TABLE job_requests
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

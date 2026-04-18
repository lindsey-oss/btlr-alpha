-- ============================================================
-- BTLR Notification Hotfix — Run this in Supabase SQL Editor
-- 1. Adds declined_at timestamp column to job_requests
-- 2. Sets REPLICA IDENTITY FULL so Realtime UPDATE events carry
--    all columns (not just PK). Required for user_id-scoped
--    realtime subscriptions to work on status changes.
-- ============================================================

ALTER TABLE job_requests
  ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;

-- Required for Supabase Realtime to send non-PK columns in UPDATE payloads.
-- Without this, postgres_changes UPDATE events only carry the primary key,
-- so any channel filter on user_id never matches.
ALTER TABLE job_requests REPLICA IDENTITY FULL;

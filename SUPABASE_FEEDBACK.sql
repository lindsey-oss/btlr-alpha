-- ============================================================
-- BTLR In-App Feedback Table
-- Run in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),

  user_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email   text,

  -- What the user reported
  what_happened   text NOT NULL,
  what_trying     text,

  -- Auto-attached context
  current_page    text,        -- e.g. "Dashboard", "Repairs", "Vendors"
  user_agent      text,
  app_version     text,

  -- Status for admin triage
  status       text NOT NULL DEFAULT 'new'  -- new | reviewed | resolved | dismissed
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Users can insert their own feedback
CREATE POLICY "Users can submit feedback"
  ON feedback FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can view their own submissions
CREATE POLICY "Users can view own feedback"
  ON feedback FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Index for admin queries
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status  ON feedback (status);
CREATE INDEX IF NOT EXISTS idx_feedback_user    ON feedback (user_id);

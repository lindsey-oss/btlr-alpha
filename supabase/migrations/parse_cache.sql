-- ─────────────────────────────────────────────────────────────────────────────
-- parse_cache: persistent store for inspection parse results.
--
-- Keyed by SHA-256 of the text sent to OpenAI (same PDF = same hash = same
-- result every time, even across server restarts or redeployments).
-- Replaces the in-process Map() cache that was lost on every cold start.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS parse_cache (
  text_hash   TEXT        PRIMARY KEY,          -- SHA-256 hex of text sent to AI
  result      JSONB       NOT NULL,             -- full finalResult object
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Allow server-side API routes (service role) to read/write
ALTER TABLE parse_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access"
  ON parse_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Auto-evict entries older than 365 days (keep table lean)
-- Run this periodically or via a cron job; safe to call any time.
-- DELETE FROM parse_cache WHERE created_at < now() - INTERVAL '365 days';

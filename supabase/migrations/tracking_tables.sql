-- ============================================================
-- BTLR Tracking Tables
-- user_consents · feedback_reports · analytics_events · error_logs
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. user_consents
--    Tracks cookie / privacy / terms acceptance
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  consent_type   text NOT NULL CHECK (consent_type IN ('cookie', 'privacy', 'terms')),
  accepted       boolean NOT NULL DEFAULT true,
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  ip_hash        text,          -- hashed, never raw IP
  user_agent     text
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user_id    ON public.user_consents (user_id);
CREATE INDEX IF NOT EXISTS idx_user_consents_type       ON public.user_consents (consent_type);
CREATE INDEX IF NOT EXISTS idx_user_consents_accepted_at ON public.user_consents (accepted_at);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

-- Users can insert their own consent; admins can read all
CREATE POLICY "users insert own consent"
  ON public.user_consents FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "users read own consent"
  ON public.user_consents FOR SELECT
  USING (user_id = auth.uid() OR user_id IS NULL);


-- ─────────────────────────────────────────────
-- 2. feedback_reports
--    Bug reports, feedback, feature requests
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  property_id uuid,
  type        text NOT NULL CHECK (type IN ('bug', 'feedback', 'confusion', 'feature_request')),
  message     text NOT NULL,
  page_url    text,
  browser     text,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'fixed', 'ignored')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_user_id    ON public.feedback_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_type       ON public.feedback_reports (type);
CREATE INDEX IF NOT EXISTS idx_feedback_status     ON public.feedback_reports (status);
CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON public.feedback_reports (created_at);

ALTER TABLE public.feedback_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own feedback"
  ON public.feedback_reports FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE POLICY "users read own feedback"
  ON public.feedback_reports FOR SELECT
  USING (user_id = auth.uid());


-- ─────────────────────────────────────────────
-- 3. analytics_events
--    Product usage — no sensitive doc content
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  property_id uuid,
  event_name  text NOT NULL,
  event_data  jsonb,            -- non-sensitive metadata only
  page_url    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_user_id    ON public.analytics_events (user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_property_id ON public.analytics_events (property_id);
CREATE INDEX IF NOT EXISTS idx_analytics_event_name ON public.analytics_events (event_name);
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON public.analytics_events (created_at);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own events"
  ON public.analytics_events FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- Users cannot read raw analytics (admin only via service role)
-- No SELECT policy intentionally — use service role for reporting


-- ─────────────────────────────────────────────
-- 4. error_logs
--    Client-side errors and stack traces
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.error_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  page_url      text,
  error_message text NOT NULL,
  stack_trace   text,
  browser       text,
  severity      text NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_errors_user_id    ON public.error_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_errors_severity   ON public.error_logs (severity);
CREATE INDEX IF NOT EXISTS idx_errors_created_at ON public.error_logs (created_at);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users insert own errors"
  ON public.error_logs FOR INSERT
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- ============================================================
-- BTLR: job_requests lifecycle columns
-- Adds scheduled_date and in_progress_at for the full
-- pending → accepted → in_progress → completed flow.
-- ============================================================

ALTER TABLE public.job_requests
  ADD COLUMN IF NOT EXISTS scheduled_date    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS in_progress_at    TIMESTAMPTZ;

-- Supported status values (job_requests.status — plain TEXT, no enum):
-- 'pending'     — Job sent to vendor, awaiting response
-- 'accepted'    — Vendor accepted; will schedule
-- 'in_progress' — Work has started
-- 'completed'   — Work done
-- 'declined'    — Vendor declined

COMMENT ON COLUMN public.job_requests.status IS
  'Valid values: pending | accepted | in_progress | completed | declined';
COMMENT ON COLUMN public.job_requests.scheduled_date IS
  'Date/time vendor has scheduled the work (set when vendor accepts with a proposed date)';
COMMENT ON COLUMN public.job_requests.in_progress_at IS
  'Timestamp when vendor marked work as started';

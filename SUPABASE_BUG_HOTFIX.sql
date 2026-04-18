-- ============================================================
-- BTLR Bug Hotfix — Run this in Supabase SQL Editor
-- Fixes:
--   1. /job/[id] inaccessible to unauthenticated users (vendors)
--      Root cause: job_requests SELECT policy may only allow auth.uid()=user_id.
--      Fix: drop and replace with policy that allows public reads (needed for
--      vendor job-link flow which is intentionally unauthenticated).
--   2. InspectionReviewModal — finding_statuses column missing from properties
--      Root cause: code reads/writes finding_statuses but no migration added it.
--      Fix: add JSONB column with {} default.
-- ============================================================

-- ── 1. job_requests: allow public (unauthenticated) SELECT ──────────────────
-- Vendors receive a job link like /job/<uuid> and must read the job without
-- being logged in. DROP the old restrictive policy and replace with one that
-- allows any SELECT while keeping authenticated INSERT scoped to the owner.

ALTER TABLE job_requests ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can read own jobs"        ON job_requests;
  DROP POLICY IF EXISTS "Anyone can read jobs by id"     ON job_requests;
  DROP POLICY IF EXISTS "Public can read job requests"   ON job_requests;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Allow anyone (including unauthenticated vendors) to SELECT any job_request.
-- The only "secret" is the UUID itself; homeowners share it intentionally.
CREATE POLICY "Public can read job requests"
  ON job_requests FOR SELECT
  USING (true);

-- Keep authenticated INSERT scoped to owner (recreate only if missing)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'job_requests' AND policyname = 'Users can insert own jobs'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Users can insert own jobs"
        ON job_requests FOR INSERT TO authenticated
        WITH CHECK (auth.uid() = user_id)
    $pol$;
  END IF;
END $$;

-- Keep open UPDATE so vendors can accept/decline without auth
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'job_requests' AND policyname = 'Anyone can update job status'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Anyone can update job status"
        ON job_requests FOR UPDATE
        USING (true)
    $pol$;
  END IF;
END $$;


-- ── 2. properties: add finding_statuses column ─────────────────────────────
-- The dashboard code reads/writes finding_statuses (a map of category → status)
-- but it was never added to any migration, causing silent UPDATE errors.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS finding_statuses JSONB DEFAULT '{}'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- BTLR: Affiliate Assets Storage Bucket
-- Run in Supabase SQL editor after affiliate_system.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- Create the public bucket for affiliate headshots and branding assets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'affiliate-assets',
  'affiliate-assets',
  true,                           -- public: URLs are readable without auth
  5242880,                        -- 5 MB max per file
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow service role to upload (handled by API route with SUPABASE_SERVICE_ROLE_KEY)
-- Public read is automatic since bucket is public = true

-- Policy: anyone can read (needed for headshots to render on the /ref/[code] page)
CREATE POLICY "Public read affiliate assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'affiliate-assets');

-- Policy: service role only for insert/update/delete
-- (our API route uses service_role key — no additional policy needed for that)

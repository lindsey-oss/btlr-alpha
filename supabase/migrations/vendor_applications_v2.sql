-- ============================================================
-- BTLR Vendor Applications — Full Schema
-- Run in Supabase SQL Editor
-- ============================================================

-- Drop old table if migrating
DROP TABLE IF EXISTS vendor_application_documents CASCADE;
DROP TABLE IF EXISTS vendor_applications CASCADE;

-- ── Main application table ────────────────────────────────────
CREATE TABLE vendor_applications (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  status                      text NOT NULL DEFAULT 'draft',
  -- draft | pending_review | needs_more_info | approved | rejected | probationary
  current_step                int NOT NULL DEFAULT 1,

  -- Step 1: Business Profile
  business_name               text,
  owner_name                  text,
  business_phone              text,
  business_email              text,
  website                     text,
  social_instagram            text,
  social_facebook             text,
  social_linkedin             text,
  social_other                text,
  address_street              text,
  address_city                text,
  address_state               text,
  address_zip                 text,
  years_in_business           text,
  team_size                   text,
  service_categories          text[] DEFAULT '{}',
  service_zip_codes           text,
  emergency_service           boolean,

  -- Step 2: Licensing & Insurance
  license_number              text,
  license_state               text,
  license_expiration          text,
  insurance_provider          text,
  workers_comp_status         text,  -- has_coverage | exempt | no_coverage
  is_bonded                   boolean,
  prior_violations            boolean,
  prior_violations_explanation text,

  -- Step 3: Services & Specialties
  primary_specialty           text,
  secondary_services          text[] DEFAULT '{}',
  average_job_size            text,
  property_types              text[] DEFAULT '{}',
  brands_systems              text,
  services_not_offered        text,

  -- Step 4: Work Quality Proof
  video_walkthrough_url       text,
  project_1_problem           text,
  project_1_solution          text,
  project_1_outcome           text,
  project_2_problem           text,
  project_2_solution          text,
  project_2_outcome           text,

  -- Step 5: Reputation & References
  google_profile_url          text,
  yelp_url                    text,
  other_review_urls           text,
  ref1_name                   text,
  ref1_phone                  text,
  ref1_email                  text,
  ref1_project_type           text,
  ref2_name                   text,
  ref2_phone                  text,
  ref2_email                  text,
  ref2_project_type           text,
  ref3_name                   text,
  ref3_phone                  text,
  ref3_email                  text,
  ref3_project_type           text,
  industry_ref_name           text,
  industry_ref_phone          text,
  industry_ref_email          text,
  industry_ref_relationship   text,

  -- Step 6: Communication & Customer Experience
  response_time               text,
  provides_written_estimates  boolean,
  upfront_pricing             boolean,
  proactive_delays            boolean,
  preferred_communication     text[] DEFAULT '{}',
  scenario_response           text,
  five_star_meaning           text,
  industry_wrongs             text,
  why_btlr                    text,

  -- Step 7: Pricing & Availability
  pricing_model               text,
  service_call_fee            text,
  estimates_free              boolean,
  typical_lead_time           text,
  weekly_job_capacity         text,
  emergency_availability      boolean,
  service_hours               text,
  after_hours                 boolean,

  -- Step 8: Agreements (each stored as bool)
  agree_license_insurance     boolean DEFAULT false,
  agree_response_window       boolean DEFAULT false,
  agree_transparent_pricing   boolean DEFAULT false,
  agree_written_estimates     boolean DEFAULT false,
  agree_no_upsells            boolean DEFAULT false,
  agree_professional          boolean DEFAULT false,
  agree_job_updates           boolean DEFAULT false,
  agree_rating_system         boolean DEFAULT false,
  agree_performance_standards boolean DEFAULT false,
  agree_probationary_removal  boolean DEFAULT false,
  agreements_signed_at        timestamptz,

  -- Step 9: Final confirmation
  final_confirmation          boolean DEFAULT false,
  submitted_at                timestamptz,

  -- Admin fields
  admin_score                 int,
  admin_score_licensing       int,   -- /30
  admin_score_reviews         int,   -- /20
  admin_score_work_quality    int,   -- /20
  admin_score_communication   int,   -- /15
  admin_score_experience      int,   -- /10
  admin_score_professionalism int,   -- /5
  admin_notes                 text,
  admin_reviewed_by           text,
  admin_reviewed_at           timestamptz,
  admin_more_info_request     text,
  is_probationary             boolean DEFAULT false
);

-- ── Documents table ────────────────────────────────────────────
CREATE TABLE vendor_application_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES vendor_applications(id) ON DELETE CASCADE,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  document_type   text NOT NULL,
  -- license | insurance | workers_comp | bond | work_photo | before_photo | after_photo
  file_name       text NOT NULL,
  file_path       text NOT NULL,  -- Supabase storage path
  file_size       int,
  mime_type       text
);

-- ── Indexes ────────────────────────────────────────────────────
CREATE INDEX ON vendor_applications (status);
CREATE INDEX ON vendor_applications (business_email);
CREATE INDEX ON vendor_applications (created_at DESC);
CREATE INDEX ON vendor_application_documents (application_id);
CREATE INDEX ON vendor_application_documents (document_type);

-- ── Auto-update updated_at ──────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_applications_updated_at
  BEFORE UPDATE ON vendor_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── RLS ────────────────────────────────────────────────────────
ALTER TABLE vendor_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_application_documents ENABLE ROW LEVEL SECURITY;

-- Anyone can insert / update their own draft (by ID, stored in their browser)
CREATE POLICY "Insert own application"
  ON vendor_applications FOR INSERT WITH CHECK (true);

CREATE POLICY "Update own draft by id"
  ON vendor_applications FOR UPDATE USING (true);

CREATE POLICY "Insert documents"
  ON vendor_application_documents FOR INSERT WITH CHECK (true);

-- Service role (admin) has full access
CREATE POLICY "Service role full access on applications"
  ON vendor_applications FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on documents"
  ON vendor_application_documents FOR ALL USING (auth.role() = 'service_role');

-- ── Storage bucket (run separately in Storage tab) ─────────────
-- Create a bucket named "vendor-docs" with:
--   Public: OFF
--   File size limit: 20MB
--   Allowed MIME types: image/*, application/pdf
-- Then add policy: "Allow anon uploads" → INSERT for anon role

-- BTLR: Regional cost ranges cache on properties table
--
-- Stores the output of /api/cost-estimates per property.
-- Loaded on property page load and passed to registerCostOverrides()
-- so the scoring engine uses regional pricing instead of national averages.
--
-- regional_cost_ranges    — full result blob from the API (ranges + location metadata)
-- regional_cost_ranges_at — timestamp of last fetch, used to enforce 90-day refresh

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS regional_cost_ranges    jsonb        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS regional_cost_ranges_at timestamptz  DEFAULT NULL;

COMMENT ON COLUMN properties.regional_cost_ranges IS
  'Cached output from /api/cost-estimates. Contains regional cost ranges by system and repair type. Null until first fetch.';

COMMENT ON COLUMN properties.regional_cost_ranges_at IS
  'Timestamp of the last regional cost fetch. Used to enforce 90-day stale threshold before re-fetching.';

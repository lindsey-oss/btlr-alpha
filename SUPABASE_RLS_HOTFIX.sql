-- ============================================================
-- BTLR RLS Hotfix — Run this in Supabase SQL Editor
-- Fixes UPDATE policy so existing rows (user_id IS NULL) can be claimed
-- ============================================================

-- Drop the strict update policy
DROP POLICY IF EXISTS "Users can update own property" ON properties;

-- Replace with one that also allows updating rows not yet claimed (user_id IS NULL)
CREATE POLICY "Users can update own property"
  ON properties FOR UPDATE
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Also fix SELECT so unclaimed rows load on first login
DROP POLICY IF EXISTS "Users can view own property" ON properties;

CREATE POLICY "Users can view own property"
  ON properties FOR SELECT
  USING (auth.uid() = user_id OR user_id IS NULL);

-- Fix: add DELETE RLS policies to home_insurance and home_warranties.
-- Without these, client-side .delete() calls are silently blocked by RLS,
-- so deleted records repopulate on page refresh.

-- home_insurance
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users delete own insurance" ON home_insurance;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users delete own insurance" ON home_insurance FOR DELETE
  USING (user_id = auth.uid());

-- home_warranties
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users delete own warranty" ON home_warranties;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE POLICY "Users delete own warranty" ON home_warranties FOR DELETE
  USING (user_id = auth.uid());

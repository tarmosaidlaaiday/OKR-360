-- The units_update policy had no WITH CHECK clause, meaning upsert (INSERT ON CONFLICT)
-- could silently skip rows without error when the RLS USING condition wasn't met.
-- Adding WITH CHECK makes both INSERT and UPDATE paths explicit.
--
-- Also backfills any units that have org_id = NULL (created before the org_id column
-- was added) by assigning them to the only org that exists, if there is exactly one.

-- Recreate update policy with explicit WITH CHECK
DROP POLICY IF EXISTS "units_update" ON public.units;
CREATE POLICY "units_update" ON public.units
  FOR UPDATE TO authenticated
  USING     (org_id = public.my_org_id())
  WITH CHECK (org_id = public.my_org_id());

-- Backfill units with null org_id: assign to the org of the unit creator if
-- there's an unambiguous single org, otherwise leave null.
UPDATE public.units u
SET org_id = (SELECT id FROM public.organisations LIMIT 1)
WHERE u.org_id IS NULL
  AND (SELECT count(*) FROM public.organisations) = 1;

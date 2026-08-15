-- Hotfix: tighten the relevant_units_insert policy to also validate the unit
-- belongs to the same org as the caller. The original policy only checked the
-- objective side, which would allow a cross-org unit to be tagged as "relevant"
-- to a real objective if the attacker knew a valid unit UUID from another org.

DROP POLICY IF EXISTS "relevant_units_insert" ON public.objective_relevant_units;

CREATE POLICY "relevant_units_insert" ON public.objective_relevant_units
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.objectives o
      JOIN public.profiles p ON p.org_id = o.org_id
      WHERE o.id = objective_id AND p.id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.units u
      JOIN public.profiles p ON p.org_id = u.org_id
      WHERE u.id = unit_id AND p.id = auth.uid()
    )
  );

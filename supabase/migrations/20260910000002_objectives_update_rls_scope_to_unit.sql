-- Correction: the previous version of this policy (20260827000001) checked
-- "is the caller admin/lead of ANY unit" with no comparison against the
-- objective's own unit_id — meaning a lead of one unit could edit or
-- reassign objectives belonging to a completely different unit in the same
-- org. This version scopes the check to the objective's actual unit.

DROP POLICY IF EXISTS "objectives_update_org" ON public.objectives;

CREATE POLICY "objectives_update_org"
  ON public.objectives FOR UPDATE TO authenticated
  USING (
    org_id = public.my_org_id()
    AND (
      owner_id = auth.uid()
      OR public.is_global_admin()
      OR EXISTS (
        SELECT 1 FROM public.people_units
        WHERE person_id = auth.uid()
          AND unit_id = objectives.unit_id
          AND role IN ('admin', 'lead')
      )
    )
  )
  WITH CHECK (
    org_id = public.my_org_id()
    AND (
      public.is_global_admin()
      OR EXISTS (
        SELECT 1 FROM public.people_units
        WHERE person_id = auth.uid()
          AND unit_id = objectives.unit_id
          AND role IN ('admin', 'lead')
      )
      OR owner_id = auth.uid()
    )
  );

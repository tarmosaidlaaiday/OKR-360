-- Fix objectives UPDATE policy so unit admins/leads can:
--   (a) edit objectives they don't personally own, and
--   (b) reassign owner_id to another person.
--
-- Root cause: the old policy had no explicit WITH CHECK clause, so Postgres
-- applied the USING expression to the new row as well. When owner_id is
-- changed away from auth.uid() the WITH CHECK fails even for global admins
-- (because owner_id in the new row is no longer theirs). Additionally, the
-- USING clause blocked unit admins who aren't the objective owner from
-- initiating the update at all.
--
-- Fix:
--   USING  — allow owner, global admin, OR any unit admin/lead in this org
--   WITH CHECK — new row must be same org AND updater is global admin,
--                unit admin/lead, or kept themselves as owner

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
          AND role IN ('admin', 'lead')
      )
      OR owner_id = auth.uid()
    )
  );

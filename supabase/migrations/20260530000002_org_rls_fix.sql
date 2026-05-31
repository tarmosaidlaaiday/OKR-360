-- Fix: organisations INSERT + UPDATE policies dropped by a previous migration.
-- Using DROP IF EXISTS + CREATE (not DO/EXCEPTION) so the policy is always
-- recreated correctly even if an older version exists.

DROP POLICY IF EXISTS "org_insert_authenticated" ON public.organisations;
CREATE POLICY "org_insert_authenticated" ON public.organisations
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "org_update_admin" ON public.organisations;
CREATE POLICY "org_update_admin" ON public.organisations
  FOR UPDATE TO authenticated
  USING (
    id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    AND (SELECT is_global_admin FROM public.profiles WHERE id = auth.uid()) = true
  );

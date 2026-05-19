-- Fix: organisations INSERT + UPDATE policies missing after RLS was enabled

-- INSERT: any authenticated user can create an org (onboarding flow)
DO $$ BEGIN
  CREATE POLICY "org_insert_authenticated" ON public.organisations
    FOR INSERT TO authenticated
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- UPDATE: org admins can update their own org
DO $$ BEGIN
  CREATE POLICY "org_update_admin" ON public.organisations
    FOR UPDATE TO authenticated
    USING (
      id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND is_global_admin = true
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

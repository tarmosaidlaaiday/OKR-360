-- Tighten organisations INSERT policy so only users without an org can create one.
-- WITH CHECK (true) allowed any authenticated user to create unlimited organisations,
-- bypassing trial limits and enabling orphan-row pollution via the keep-alive CI job.
--
-- New rule: my_org_id() IS NULL — INSERT is only permitted when the caller has no
-- org yet. This is exactly the onboarding case. Users who already belong to an org
-- cannot create a second one via PostgREST.
--
-- Also clean up _keepalive_* orphan rows created by the old CI ping strategy.

-- Drop all permissive INSERT policies (names varied across earlier migrations)
DROP POLICY IF EXISTS "org_insert"                ON public.organisations;
DROP POLICY IF EXISTS "org_insert_anon_temp"      ON public.organisations;
DROP POLICY IF EXISTS "org_insert_authenticated"  ON public.organisations;
DROP POLICY IF EXISTS "orgs_insert_auth"          ON public.organisations;

-- Recreate with correct constraint
CREATE POLICY "org_insert"
  ON public.organisations
  FOR INSERT TO authenticated
  WITH CHECK (public.my_org_id() IS NULL);

-- Remove orphan rows created by the weekly keep-alive INSERT ping
DELETE FROM public.organisations WHERE name LIKE '_keepalive_%';

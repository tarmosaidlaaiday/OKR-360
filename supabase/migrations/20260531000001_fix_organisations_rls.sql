-- ── Definitive organisations RLS fix ─────────────────────────────────────────
--
-- Root causes this fixes:
--
--  1. supabase db push was never successfully run on this project (CLI absent),
--     so all previous fix migrations (016, 20260530_002) never hit the DB.
--
--  2. Migration 20260519000012 created my_org_id() BEFORE adding profiles.org_id,
--     so the function and the policies that use it may be in a broken state.
--
--  3. Multiple migrations used DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN
--     null; END $$; which silently no-ops if any version of the policy already
--     exists — even a broken one.
--
-- Strategy: drop ALL existing policies on organisations and recreate from scratch.
-- Then also recreate my_org_id() now that profiles.org_id definitely exists.
--
-- APPLY THIS DIRECTLY IN THE SUPABASE SQL EDITOR — do NOT rely on db push.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Ensure profiles.org_id exists (idempotent) ─────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.organisations(id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_global_admin boolean NOT NULL DEFAULT false;

-- ── 2. Recreate my_org_id() now that profiles.org_id definitely exists ─────────

CREATE OR REPLACE FUNCTION public.my_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid()
$$;
GRANT EXECUTE ON FUNCTION public.my_org_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_global_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT is_global_admin FROM public.profiles WHERE id = auth.uid()),
    false
  )
$$;
GRANT EXECUTE ON FUNCTION public.is_global_admin() TO authenticated;

-- ── 3. Drop ALL existing policies on organisations ────────────────────────────

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'organisations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.organisations', pol.policyname);
  END LOOP;
END $$;

-- ── 4. Ensure RLS is enabled ──────────────────────────────────────────────────

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;

-- ── 5. Recreate clean policy set ──────────────────────────────────────────────

-- Any authenticated user can create a new org (required for onboarding)
CREATE POLICY "org_insert"
  ON public.organisations
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Users can read only their own org
CREATE POLICY "org_select"
  ON public.organisations
  FOR SELECT TO authenticated
  USING (id = public.my_org_id());

-- Global admins can update their org
CREATE POLICY "org_update"
  ON public.organisations
  FOR UPDATE TO authenticated
  USING (id = public.my_org_id() AND public.is_global_admin());

-- ── 6. Verify (run manually, expect 3 rows) ───────────────────────────────────
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'organisations';

-- ============================================================
-- Fix multi-tenant RLS: scope units, levels, org_settings,
-- cycles to the authenticated user's org only.
--
-- Previously: _read_all / _write_auth policies were too broad
-- (no org_id filter), causing cross-org data leaks.
-- ============================================================

-- ── units ────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "units_read_all" ON public.units;
DROP POLICY IF EXISTS "units_write_auth" ON public.units;

CREATE POLICY "units_select" ON public.units
  FOR SELECT TO authenticated
  USING (org_id = public.my_org_id());

CREATE POLICY "units_insert" ON public.units
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.my_org_id());

CREATE POLICY "units_update" ON public.units
  FOR UPDATE TO authenticated
  USING (org_id = public.my_org_id());

CREATE POLICY "units_delete" ON public.units
  FOR DELETE TO authenticated
  USING (org_id = public.my_org_id());

-- ── levels ───────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "levels_read_all" ON public.levels;
DROP POLICY IF EXISTS "levels_write_auth" ON public.levels;

CREATE POLICY "levels_select" ON public.levels
  FOR SELECT TO authenticated
  USING (org_id = public.my_org_id());

CREATE POLICY "levels_insert" ON public.levels
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.my_org_id());

CREATE POLICY "levels_update" ON public.levels
  FOR UPDATE TO authenticated
  USING (org_id = public.my_org_id());

CREATE POLICY "levels_delete" ON public.levels
  FOR DELETE TO authenticated
  USING (org_id = public.my_org_id());

-- ── org_settings ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "org_settings_read_all" ON public.org_settings;
DROP POLICY IF EXISTS "org_settings_write_auth" ON public.org_settings;

CREATE POLICY "org_settings_select" ON public.org_settings
  FOR SELECT TO authenticated
  USING (org_id = public.my_org_id());

CREATE POLICY "org_settings_insert" ON public.org_settings
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.my_org_id());

CREATE POLICY "org_settings_update" ON public.org_settings
  FOR UPDATE TO authenticated
  USING (org_id = public.my_org_id());

-- ── cycles ───────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "cycles: authenticated can read all" ON public.cycles;

CREATE POLICY "cycles_select" ON public.cycles
  FOR SELECT TO authenticated
  USING (org_id = public.my_org_id());

CREATE POLICY "cycles_insert" ON public.cycles
  FOR INSERT TO authenticated
  WITH CHECK (org_id = public.my_org_id());

CREATE POLICY "cycles_update" ON public.cycles
  FOR UPDATE TO authenticated
  USING (org_id = public.my_org_id());

-- ── Backfill: assign orphaned rows to the oldest org ─────────────────────────
-- Any rows without org_id predate multi-tenancy and belong to the seed org.

DO $$
DECLARE first_org_id uuid;
BEGIN
  SELECT id INTO first_org_id FROM public.organisations ORDER BY created_at ASC LIMIT 1;
  IF first_org_id IS NULL THEN RETURN; END IF;

  UPDATE public.units  SET org_id = first_org_id WHERE org_id IS NULL;
  UPDATE public.levels SET org_id = first_org_id WHERE org_id IS NULL;
  UPDATE public.cycles SET org_id = first_org_id WHERE org_id IS NULL;
END $$;

SELECT 'multitenant RLS fix complete' AS status;

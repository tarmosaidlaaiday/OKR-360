-- Emergency fix: four tables created in
-- 20260714000002_missing_tables_hotfix.sql carried over pre-multi-tenancy
-- RLS policies verbatim (USING (true) / WITH CHECK (true)), creating real
-- cross-tenant read and write holes. This corrects all four in place.

-- ── kpi_targets ── worst one: fully open write, any authenticated user
-- from any org could modify/delete any other org's KPI plan values.
DROP POLICY IF EXISTS "kpi_targets_read" ON public.kpi_targets;
CREATE POLICY "kpi_targets_read" ON public.kpi_targets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.kpis k
      JOIN public.profiles p ON p.org_id = k.org_id
      WHERE k.id = kpi_targets.kpi_id AND p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "kpi_targets_write" ON public.kpi_targets;
CREATE POLICY "kpi_targets_write" ON public.kpi_targets
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.kpis k
      JOIN public.profiles p ON p.org_id = k.org_id
      WHERE k.id = kpi_targets.kpi_id AND p.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.kpis k
      JOIN public.profiles p ON p.org_id = k.org_id
      WHERE k.id = kpi_id AND p.id = auth.uid()
    )
  );

-- ── kpi_snapshots ── read was fully open; write only checked identity,
-- never that the KPI being written to belongs to the writer's own org.
DROP POLICY IF EXISTS "kpi_snapshots_read" ON public.kpi_snapshots;
CREATE POLICY "kpi_snapshots_read" ON public.kpi_snapshots
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.kpis k
      JOIN public.profiles p ON p.org_id = k.org_id
      WHERE k.id = kpi_snapshots.kpi_id AND p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "kpi_snapshots_insert" ON public.kpi_snapshots;
CREATE POLICY "kpi_snapshots_insert" ON public.kpi_snapshots
  FOR INSERT TO authenticated
  WITH CHECK (
    recorded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.kpis k
      JOIN public.profiles p ON p.org_id = k.org_id
      WHERE k.id = kpi_id AND p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "kpi_snapshots_update" ON public.kpi_snapshots;
CREATE POLICY "kpi_snapshots_update" ON public.kpi_snapshots
  FOR UPDATE TO authenticated
  USING (
    recorded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.kpis k
      JOIN public.profiles p ON p.org_id = k.org_id
      WHERE k.id = kpi_snapshots.kpi_id AND p.id = auth.uid()
    )
  );

-- ── objective_reviews ── read was fully open; the admin-write policy had
-- no org check at all, letting a global admin of ANY org touch another
-- org's review reflections.
DROP POLICY IF EXISTS "obj_reviews_read_auth" ON public.objective_reviews;
CREATE POLICY "obj_reviews_read_auth" ON public.objective_reviews
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.objectives o
      JOIN public.profiles p ON p.org_id = o.org_id
      WHERE o.id = objective_reviews.objective_id AND p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "obj_reviews_write_admin" ON public.objective_reviews;
CREATE POLICY "obj_reviews_write_admin" ON public.objective_reviews
  FOR ALL TO authenticated
  USING (
    public.is_global_admin()
    AND EXISTS (
      SELECT 1 FROM public.objectives o
      JOIN public.profiles p ON p.org_id = o.org_id
      WHERE o.id = objective_reviews.objective_id AND p.id = auth.uid()
    )
  );
-- obj_reviews_write_own is unchanged — it was already correctly scoped
-- to reviewer_id = auth.uid().

-- ── retros ── read was fully open across every org. retros has no direct
-- org_id column, so scope via whichever of unit_id/person_id is set.
DROP POLICY IF EXISTS "retros_read_auth" ON public.retros;
CREATE POLICY "retros_read_auth" ON public.retros
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND (
        (retros.unit_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.units u WHERE u.id = retros.unit_id AND u.org_id = p.org_id
        ))
        OR
        (retros.person_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.profiles pp WHERE pp.id = retros.person_id AND pp.org_id = p.org_id
        ))
      )
    )
  );
-- retros_write_own is unchanged — it was already correctly scoped to
-- person_id/created_by = auth.uid().

-- Guardrail KPIs: a many-to-many relationship from Objective to KPI.
-- A guardrail KPI is one whose deterioration should be visible on the objective.
-- Separate from the KPI → KR link (which is a "this KPI measures this KR" link).

CREATE TABLE IF NOT EXISTS public.objective_guardrail_kpis (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES public.objectives(id) ON DELETE CASCADE,
  kpi_id       uuid NOT NULL REFERENCES public.kpis(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(objective_id, kpi_id)
);

ALTER TABLE public.objective_guardrail_kpis ENABLE ROW LEVEL SECURITY;

-- Org members can read all guardrails for objectives in their org
DO $$ BEGIN
  CREATE POLICY "guardrail_read" ON public.objective_guardrail_kpis
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.objectives o
        JOIN public.profiles p ON p.org_id = o.org_id
        WHERE o.id = objective_guardrail_kpis.objective_id
          AND p.id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Caller must belong to the same org as both the objective and the KPI
DO $$ BEGIN
  CREATE POLICY "guardrail_insert" ON public.objective_guardrail_kpis
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.objectives o
        JOIN public.profiles p ON p.org_id = o.org_id
        WHERE o.id = objective_id AND p.id = auth.uid()
      )
      AND EXISTS (
        SELECT 1 FROM public.kpis k
        JOIN public.profiles p ON p.org_id = k.org_id
        WHERE k.id = kpi_id AND p.id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Any org member can remove a guardrail on their org's objectives
DO $$ BEGIN
  CREATE POLICY "guardrail_delete" ON public.objective_guardrail_kpis
    FOR DELETE TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.objectives o
        JOIN public.profiles p ON p.org_id = o.org_id
        WHERE o.id = objective_guardrail_kpis.objective_id
          AND p.id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

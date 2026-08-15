-- Objective-relevant-units: tag which units a given objective is expected to
-- apply to. Separate from alignment (parent_objective_id) — this records the
-- expectation ("Sales should align to this"), whereas parent_objective_id
-- records that the alignment has actually happened.
-- Used to drive the Waterfall view that surfaces alignment gaps.

CREATE TABLE IF NOT EXISTS public.objective_relevant_units (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL REFERENCES public.objectives(id) ON DELETE CASCADE,
  unit_id      uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (objective_id, unit_id)
);

ALTER TABLE public.objective_relevant_units ENABLE ROW LEVEL SECURITY;

-- Org members can read which units are tagged as relevant on objectives in their org
DO $$ BEGIN
  CREATE POLICY "relevant_units_read" ON public.objective_relevant_units
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.objectives o
        JOIN public.profiles p ON p.org_id = o.org_id
        WHERE o.id = objective_relevant_units.objective_id
          AND p.id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Caller must belong to the same org as the objective being tagged
DO $$ BEGIN
  CREATE POLICY "relevant_units_insert" ON public.objective_relevant_units
    FOR INSERT TO authenticated
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.objectives o
        JOIN public.profiles p ON p.org_id = o.org_id
        WHERE o.id = objective_id AND p.id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Any org member can remove a relevance tag on their org's objectives
DO $$ BEGIN
  CREATE POLICY "relevant_units_delete" ON public.objective_relevant_units
    FOR DELETE TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.objectives o
        JOIN public.profiles p ON p.org_id = o.org_id
        WHERE o.id = objective_relevant_units.objective_id
          AND p.id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

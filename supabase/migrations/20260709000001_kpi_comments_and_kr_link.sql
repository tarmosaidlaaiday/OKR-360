-- Task 2: Extend comments to support KPIs
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS kpi_id uuid REFERENCES public.kpis(id) ON DELETE CASCADE;

ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_one_target;
ALTER TABLE public.comments ADD CONSTRAINT comments_one_target CHECK (
  (objective_id IS NOT NULL)::int + (key_result_id IS NOT NULL)::int + (kpi_id IS NOT NULL)::int = 1
);

CREATE INDEX IF NOT EXISTS comments_kpi_idx ON public.comments(kpi_id) WHERE kpi_id IS NOT NULL;

-- Task 3: Optional KPI → Key Result link
ALTER TABLE public.kpis
  ADD COLUMN IF NOT EXISTS key_result_id uuid REFERENCES public.key_results(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_kpis_key_result_id ON public.kpis(key_result_id)
  WHERE key_result_id IS NOT NULL;

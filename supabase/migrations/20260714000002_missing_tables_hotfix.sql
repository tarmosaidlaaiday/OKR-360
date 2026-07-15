-- Hotfix: create tables that were never applied to the live database.
-- All statements are idempotent (IF NOT EXISTS / DO...EXCEPTION).
-- Tables: initiatives, objective_reviews, kpi_targets, kpi_snapshots, retros

-- ── initiatives ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.initiatives (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  owner_id        uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  owner_person_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  unit_id         uuid REFERENCES public.units(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'On track',
  progress        numeric NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  due_label       text,
  due             text,
  year            int DEFAULT EXTRACT(YEAR FROM now())::int,
  cycle_id        uuid REFERENCES public.cycles(id) ON DELETE SET NULL,
  org_id          uuid REFERENCES public.organisations(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.initiatives ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "initiatives_read_org" ON public.initiatives
    FOR SELECT TO authenticated USING (org_id = public.my_org_id());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "initiatives_write_org" ON public.initiatives
    FOR ALL TO authenticated
    USING (org_id = public.my_org_id())
    WITH CHECK (org_id = public.my_org_id());
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Auto-set org_id on insert
DO $$ BEGIN
  CREATE TRIGGER set_org_id_initiatives
    BEFORE INSERT ON public.initiatives
    FOR EACH ROW EXECUTE FUNCTION public.set_org_id();
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS idx_initiatives_org_id ON public.initiatives(org_id);


-- ── objective_reviews ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.objective_reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id          uuid NOT NULL REFERENCES public.objectives(id) ON DELETE CASCADE,
  cycle_id              uuid NOT NULL REFERENCES public.cycles(id) ON DELETE CASCADE,
  reviewer_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stage                 text NOT NULL CHECK (stage IN ('self','manager','final')),
  submitted_at          timestamptz,
  reflection_what_drove text,
  reflection_improve    text,
  carry_forward         text DEFAULT 'no' CHECK (carry_forward IN ('yes','partial','no')),
  overall_note          text,
  UNIQUE (objective_id, reviewer_id, stage)
);

CREATE INDEX IF NOT EXISTS objective_reviews_cycle_idx     ON public.objective_reviews(cycle_id);
CREATE INDEX IF NOT EXISTS objective_reviews_reviewer_idx  ON public.objective_reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS objective_reviews_objective_idx ON public.objective_reviews(objective_id);

ALTER TABLE public.objective_reviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "obj_reviews_read_auth" ON public.objective_reviews
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "obj_reviews_write_own" ON public.objective_reviews
    FOR ALL TO authenticated
    USING (reviewer_id = auth.uid())
    WITH CHECK (reviewer_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "obj_reviews_write_admin" ON public.objective_reviews
    FOR ALL TO authenticated USING (public.is_global_admin());
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── kpi_targets ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kpi_targets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id     uuid NOT NULL REFERENCES public.kpis(id) ON DELETE CASCADE,
  cycle_id   uuid NOT NULL REFERENCES public.cycles(id),
  plan_value numeric NOT NULL,
  UNIQUE (kpi_id, cycle_id)
);

ALTER TABLE public.kpi_targets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "kpi_targets_read" ON public.kpi_targets
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "kpi_targets_write" ON public.kpi_targets
    FOR ALL TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Backfill from existing kpis
INSERT INTO public.kpi_targets (kpi_id, cycle_id, plan_value)
SELECT id, cycle_id, COALESCE(plan, 0)
FROM public.kpis
WHERE cycle_id IS NOT NULL AND plan IS NOT NULL
ON CONFLICT (kpi_id, cycle_id) DO NOTHING;


-- ── kpi_snapshots ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kpi_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id      uuid NOT NULL REFERENCES public.kpis(id) ON DELETE CASCADE,
  value       numeric NOT NULL,
  week_number int,
  year        int,
  recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kpi_id, week_number, year)
);

CREATE INDEX IF NOT EXISTS kpi_snapshots_kpi_week_idx
  ON public.kpi_snapshots(kpi_id, year DESC, week_number DESC);

ALTER TABLE public.kpi_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "kpi_snapshots_read" ON public.kpi_snapshots
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "kpi_snapshots_insert" ON public.kpi_snapshots
    FOR INSERT TO authenticated WITH CHECK (recorded_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "kpi_snapshots_update" ON public.kpi_snapshots
    FOR UPDATE TO authenticated USING (recorded_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── retros ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.retros (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  unit_id        uuid REFERENCES public.units(id) ON DELETE CASCADE,
  week_number    int  NOT NULL,
  year           int  NOT NULL,
  parking_lot    text,
  top_work       text,
  notes_text     text,
  feedforward    text,
  start_items    text[] DEFAULT '{}',
  stop_items     text[] DEFAULT '{}',
  continue_items text[] DEFAULT '{}',
  created_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.retros ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "retros_read_auth" ON public.retros
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "retros_write_own" ON public.retros
    FOR ALL TO authenticated
    USING (person_id = auth.uid() OR created_by = auth.uid())
    WITH CHECK (person_id = auth.uid() OR created_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN null; END $$;

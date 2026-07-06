-- ── KPIs schema upgrade ──────────────────────────────────────────────────

ALTER TABLE public.kpis
  ADD COLUMN IF NOT EXISTS unit_id        uuid REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_person_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS good           text DEFAULT 'up' CHECK (good IN ('up','down')),
  ADD COLUMN IF NOT EXISTS cycle_id       uuid REFERENCES public.cycles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Backfill good from direction where good is NULL
UPDATE public.kpis SET good = direction WHERE good IS NULL AND direction IS NOT NULL;
-- Backfill owner_person_id from owner_id where owner_person_id is NULL
UPDATE public.kpis SET owner_person_id = owner_id WHERE owner_person_id IS NULL AND owner_id IS NOT NULL;

-- ── kpi_targets ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.kpi_targets (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kpi_id    uuid NOT NULL REFERENCES public.kpis(id) ON DELETE CASCADE,
  cycle_id  uuid NOT NULL REFERENCES public.cycles(id),
  plan_value numeric NOT NULL,
  UNIQUE (kpi_id, cycle_id)
);

ALTER TABLE public.kpi_targets ENABLE ROW LEVEL SECURITY;

-- Backfill kpi_targets from existing kpis.plan + kpis.cycle_id
INSERT INTO public.kpi_targets (kpi_id, cycle_id, plan_value)
SELECT id, cycle_id, COALESCE(plan, 0)
FROM public.kpis
WHERE cycle_id IS NOT NULL AND plan IS NOT NULL
ON CONFLICT (kpi_id, cycle_id) DO NOTHING;

DO $$ BEGIN
  CREATE POLICY "kpi_targets_read" ON public.kpi_targets
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "kpi_targets_write" ON public.kpi_targets
    FOR ALL TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── kpi_snapshots ─────────────────────────────────────────────────────────

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
  CREATE POLICY "kpi_snapshots_upsert" ON public.kpi_snapshots
    FOR UPDATE TO authenticated USING (recorded_by = auth.uid());
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Backfill a single snapshot from existing kpis.actual for current week
INSERT INTO public.kpi_snapshots (kpi_id, value, week_number, year, recorded_by)
SELECT id, COALESCE(actual, 0), 20, 2026, owner_id
FROM public.kpis
WHERE actual IS NOT NULL AND owner_id IS NOT NULL
ON CONFLICT (kpi_id, week_number, year) DO NOTHING;


-- ── 1:1 schema upgrade ────────────────────────────────────────────────────

ALTER TABLE public.one_on_ones
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS status       text DEFAULT 'draft' CHECK (status IN ('draft','done')),
  ADD COLUMN IF NOT EXISTS cycle_id     uuid REFERENCES public.cycles(id) ON DELETE SET NULL;

-- Backfill status from done boolean
UPDATE public.one_on_ones
SET status = CASE WHEN done THEN 'done' ELSE 'draft' END
WHERE status IS NULL;

-- Backfill scheduled_at from meeting_date
UPDATE public.one_on_ones
SET scheduled_at = meeting_date::timestamptz
WHERE scheduled_at IS NULL AND meeting_date IS NOT NULL;


-- ── one_on_one_entries ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.one_on_one_entries (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  one_on_one_id          uuid NOT NULL REFERENCES public.one_on_ones(id) ON DELETE CASCADE,
  personal_highlight     text,
  professional_highlight text,
  personal_low           text,
  professional_low       text,
  work_wins              text,
  work_blockers          text,
  work_needs_manager     text,
  work_topics            text,
  feedback_for_report    text,
  feedback_from_report   text,
  happiness              int CHECK (happiness >= 1 AND happiness <= 10),
  happiness_followup     text,
  submitted_at           timestamptz,
  last_saved_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.one_on_one_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "oo_entries_participants" ON public.one_on_one_entries
    FOR ALL TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.one_on_ones oo
        WHERE oo.id = one_on_one_entries.one_on_one_id
          AND (oo.manager_id = auth.uid() OR oo.report_id = auth.uid())
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.one_on_ones oo
        WHERE oo.id = one_on_one_entries.one_on_one_id
          AND (oo.manager_id = auth.uid() OR oo.report_id = auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Backfill existing one_on_one happiness into entries
INSERT INTO public.one_on_one_entries (one_on_one_id, happiness, last_saved_at)
SELECT id, happiness, COALESCE(created_at, now())
FROM public.one_on_ones
WHERE happiness IS NOT NULL
ON CONFLICT DO NOTHING;


-- ── one_on_one_discussed_objectives ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.one_on_one_discussed_objectives (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  one_on_one_id   uuid NOT NULL REFERENCES public.one_on_ones(id) ON DELETE CASCADE,
  objective_id    uuid NOT NULL REFERENCES public.objectives(id) ON DELETE CASCADE,
  discuss         boolean NOT NULL DEFAULT false,
  UNIQUE (one_on_one_id, objective_id)
);

ALTER TABLE public.one_on_one_discussed_objectives ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "oo_disc_obj_participants" ON public.one_on_one_discussed_objectives
    FOR ALL TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.one_on_ones oo
        WHERE oo.id = one_on_one_discussed_objectives.one_on_one_id
          AND (oo.manager_id = auth.uid() OR oo.report_id = auth.uid())
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.one_on_ones oo
        WHERE oo.id = one_on_one_discussed_objectives.one_on_one_id
          AND (oo.manager_id = auth.uid() OR oo.report_id = auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── Seed: KPIs ───────────────────────────────────────────────────────────
-- WARNING: This block uses EXCEPTION WHEN OTHERS THEN NULL (line ~251).
-- Any failure inside (missing table, FK violation, etc.) is silently swallowed.
-- The migration will be recorded as applied even if the seed data was never inserted.
-- If you need to re-seed KPIs, run the INSERT statements manually in the SQL Editor.

DO $$
DECLARE
  v_cycle_id uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_p5 uuid;
  v_k uuid;
  v_profiles uuid[];
BEGIN
  -- Skip if KPIs already seeded with good column populated
  IF EXISTS (SELECT 1 FROM public.kpis WHERE good IS NOT NULL LIMIT 1) THEN
    -- Already have data, just ensure targets exist
    RETURN;
  END IF;

  -- Get active or most recent cycle
  SELECT id INTO v_cycle_id FROM public.cycles WHERE status = 'active' LIMIT 1;
  IF v_cycle_id IS NULL THEN
    SELECT id INTO v_cycle_id FROM public.cycles ORDER BY year DESC, quarter DESC LIMIT 1;
  END IF;
  IF v_cycle_id IS NULL THEN RETURN; END IF;

  -- Get up to 5 profiles in creation order
  SELECT ARRAY(SELECT id FROM public.profiles ORDER BY created_at LIMIT 5)
  INTO v_profiles;

  IF array_length(v_profiles, 1) IS NULL OR array_length(v_profiles, 1) = 0 THEN
    RETURN;
  END IF;

  v_p1 := v_profiles[1];
  v_p2 := COALESCE(v_profiles[2], v_profiles[1]);
  v_p3 := COALESCE(v_profiles[3], v_profiles[1]);
  v_p4 := COALESCE(v_profiles[4], v_profiles[1]);
  v_p5 := COALESCE(v_profiles[5], v_profiles[1]);

  -- Insert KPIs
  INSERT INTO public.kpis (name, unit, good, role_name, owner_person_id, owner_id, plan, actual, cycle_id, created_by)
  VALUES
    ('Activation rate',        '%',   'up',   'Head of Product',   v_p1, v_p1, 55,   47,   v_cycle_id, v_p1),
    ('Time-to-value (median)', 'min', 'down', 'Head of Product',   v_p1, v_p1, 7,    9.2,  v_cycle_id, v_p1),
    ('p95 dashboard latency',  'ms',  'down', 'Engineering Lead',  v_p2, v_p2, 200,  214,  v_cycle_id, v_p2),
    ('Deploys per week',       '',    'up',   'Engineering Lead',  v_p2, v_p2, 25,   31,   v_cycle_id, v_p2),
    ('Pipeline coverage',      'x',   'up',   'Head of Sales',     v_p3, v_p3, 3.5,  3.6,  v_cycle_id, v_p3),
    ('Net revenue retention',  '%',   'up',   'Head of Sales',     v_p3, v_p3, 115,  109,  v_cycle_id, v_p3),
    ('Trial signups',          '/mo', 'up',   'Head of Marketing', v_p4, v_p4, 1200, 740,  v_cycle_id, v_p4),
    ('Cost per qualified lead','€',   'down', 'Head of Marketing', v_p4, v_p4, 180,  168,  v_cycle_id, v_p4),
    ('Cash runway',            'mo',  'up',   'CEO',               v_p5, v_p5, 24,   23,   v_cycle_id, v_p5),
    ('Employee eNPS',          '',    'up',   'CEO',               v_p5, v_p5, 45,   52,   v_cycle_id, v_p5)
  ON CONFLICT DO NOTHING;

  -- Insert kpi_targets for each seeded KPI
  INSERT INTO public.kpi_targets (kpi_id, cycle_id, plan_value)
  SELECT id, v_cycle_id, COALESCE(plan, 0)
  FROM public.kpis
  WHERE cycle_id = v_cycle_id AND good IS NOT NULL
  ON CONFLICT (kpi_id, cycle_id) DO NOTHING;

  -- Insert snapshot for current week (week 20, 2026)
  INSERT INTO public.kpi_snapshots (kpi_id, value, week_number, year, recorded_by)
  SELECT id, COALESCE(actual, 0), 20, 2026, owner_person_id
  FROM public.kpis
  WHERE cycle_id = v_cycle_id AND actual IS NOT NULL AND owner_person_id IS NOT NULL
  ON CONFLICT (kpi_id, week_number, year) DO NOTHING;

EXCEPTION WHEN OTHERS THEN NULL;
END $$;


-- ── Seed: 1:1 sessions ───────────────────────────────────────────────────
-- WARNING: Same EXCEPTION WHEN OTHERS THEN NULL pattern — failures are silent.

DO $$
DECLARE
  v_mgr uuid;  -- first profile = "manager"
  v_rep uuid;  -- second profile = "report"
  v_oo  uuid;
BEGIN
  -- Skip if one_on_ones already has status column data
  IF EXISTS (SELECT 1 FROM public.one_on_ones WHERE status IS NOT NULL LIMIT 1) THEN
    RETURN;
  END IF;

  SELECT id INTO v_mgr FROM public.profiles ORDER BY created_at LIMIT 1;
  SELECT id INTO v_rep FROM public.profiles ORDER BY created_at OFFSET 1 LIMIT 1;

  IF v_mgr IS NULL OR v_rep IS NULL OR v_mgr = v_rep THEN
    RETURN;
  END IF;

  -- 4 done sessions
  INSERT INTO public.one_on_ones (manager_id, report_id, scheduled_at, status, done, happiness, summary)
  VALUES
    (v_mgr, v_rep, '2026-04-13 14:00:00+00', 'done', true,  8, 'Great week — shipped the migration plan.'),
    (v_mgr, v_rep, '2026-04-20 14:00:00+00', 'done', true,  6, 'Tired. Asked for a Friday off. Wants more deep work.'),
    (v_mgr, v_rep, '2026-04-27 14:00:00+00', 'done', true,  7, 'Bundle-size work is unblocked. Still worried about p95.'),
    (v_mgr, v_rep, '2026-05-04 14:00:00+00', 'done', true,  6, 'EU migration on track but solo on it.')
  ON CONFLICT DO NOTHING;

  -- 1 draft session
  INSERT INTO public.one_on_ones (manager_id, report_id, scheduled_at, status, done)
  VALUES (v_mgr, v_rep, '2026-05-11 14:00:00+00', 'draft', false)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_oo;

  -- Entry row for the draft
  IF v_oo IS NOT NULL THEN
    INSERT INTO public.one_on_one_entries (one_on_one_id)
    VALUES (v_oo)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Backfill entries for done sessions (happiness)
  INSERT INTO public.one_on_one_entries (one_on_one_id, happiness)
  SELECT id, happiness FROM public.one_on_ones
  WHERE manager_id = v_mgr AND report_id = v_rep AND happiness IS NOT NULL AND status = 'done'
  ON CONFLICT DO NOTHING;

EXCEPTION WHEN OTHERS THEN NULL;
END $$;

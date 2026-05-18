-- ── Schema backfill: ensure all tables, columns, and functions exist ─────────
-- Safe to run multiple times (idempotent).

-- ── 1. profiles: add missing columns ────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role          text,
  ADD COLUMN IF NOT EXISTS email         text,
  ADD COLUMN IF NOT EXISTS job_title     text,
  ADD COLUMN IF NOT EXISTS is_global_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS invited_by    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Backfill email from auth.users
UPDATE public.profiles p
SET email = au.email
FROM auth.users au
WHERE au.id = p.id AND p.email IS NULL;

-- Status constraint (idempotent)
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check CHECK (status IN ('active','pending','inactive'));

-- ── 2. profiles: ensure SELECT policy exists ─────────────────────────────────

DO $$ BEGIN
  DROP POLICY IF EXISTS "profiles: authenticated can read all" ON public.profiles;
EXCEPTION WHEN undefined_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "profiles_read_all" ON public.profiles
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 3. levels table (from schema-org-structure.sql) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.levels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  color      text NOT NULL DEFAULT '#6366f1',
  position   int  NOT NULL DEFAULT 0,
  enabled    bool NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.levels ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "levels_read_all" ON public.levels FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "levels_write_auth" ON public.levels FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null; END $$;

INSERT INTO public.levels (name, color, position, enabled) VALUES
  ('Group',      '#6366f1', 0, true),
  ('Subsidiary', '#8b5cf6', 1, true),
  ('Department', '#3b82f6', 2, true),
  ('Team',       '#22c55e', 3, true)
ON CONFLICT DO NOTHING;


-- ── 4. units table (from schema-org-structure.sql) ──────────────────────────

CREATE TABLE IF NOT EXISTS public.units (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  level_id   uuid REFERENCES public.levels(id) ON DELETE SET NULL,
  parent_id  uuid REFERENCES public.units(id)  ON DELETE SET NULL,
  position   int  NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_units_parent   ON public.units(parent_id);
CREATE INDEX IF NOT EXISTS idx_units_level    ON public.units(level_id);
CREATE INDEX IF NOT EXISTS idx_units_position ON public.units(position);

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "units_read_all" ON public.units FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "units_write_auth" ON public.units FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 5. org_settings (from schema-org-structure.sql) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.org_settings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  require_parent_link      bool NOT NULL DEFAULT false,
  allow_cross_level        bool NOT NULL DEFAULT false,
  individual_level_enabled bool NOT NULL DEFAULT false,
  show_alignment_gaps      bool NOT NULL DEFAULT true,
  updated_at               timestamptz DEFAULT now()
);

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "org_settings_read_all" ON public.org_settings FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "org_settings_write_auth" ON public.org_settings FOR ALL USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null; END $$;

INSERT INTO public.org_settings (require_parent_link, allow_cross_level, individual_level_enabled, show_alignment_gaps)
VALUES (false, false, false, true)
ON CONFLICT DO NOTHING;


-- ── 6. org_levels table (for OKR cascade hierarchy) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.org_levels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  depth      int  NOT NULL CHECK (depth >= 0 AND depth <= 4),
  color      text NOT NULL DEFAULT '#6366f1',
  created_at timestamptz DEFAULT now(),
  UNIQUE (depth)
);

ALTER TABLE public.org_levels ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "org_levels_read_all" ON public.org_levels FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

INSERT INTO public.org_levels (name, depth, color) VALUES
  ('Group',      0, '#6366f1'),
  ('Subsidiary', 1, '#8b5cf6'),
  ('Department', 2, '#3b82f6'),
  ('Team',       3, '#22c55e')
ON CONFLICT (depth) DO NOTHING;


-- ── 7. objectives: add cascade columns ──────────────────────────────────────

ALTER TABLE public.objectives
  ADD COLUMN IF NOT EXISTS unit_id              uuid REFERENCES public.units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_objective_id  uuid REFERENCES public.objectives(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS level_id             uuid REFERENCES public.org_levels(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_objectives_unit   ON public.objectives(unit_id);
CREATE INDEX IF NOT EXISTS idx_objectives_parent ON public.objectives(parent_objective_id);
CREATE INDEX IF NOT EXISTS idx_objectives_level  ON public.objectives(level_id);


-- ── 8. cycles: add status column ────────────────────────────────────────────

ALTER TABLE public.cycles
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.cycles
  DROP CONSTRAINT IF EXISTS cycles_status_check;
ALTER TABLE public.cycles
  ADD CONSTRAINT cycles_status_check CHECK (status IN ('draft','active','reviewing','archived'));


-- ── 9. Fix Q2 2026 cycle dates ───────────────────────────────────────────────
-- Ensure there is exactly one active Q2 2026 cycle with correct dates

INSERT INTO public.cycles (year, quarter, label, start_date, end_date, status)
VALUES (2026, 2, 'Q2 2026', '2026-04-01', '2026-06-30', 'active')
ON CONFLICT (year, quarter) DO UPDATE SET
  label      = 'Q2 2026',
  start_date = '2026-04-01',
  end_date   = '2026-06-30',
  status     = 'active';

-- Archive any Q1 2026 cycle
UPDATE public.cycles SET status = 'archived'
WHERE year = 2026 AND quarter = 1;


-- ── 10. Helper functions (must come before people_units RLS policies) ────────

CREATE OR REPLACE FUNCTION public.is_global_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT is_global_admin FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_global_admin() TO authenticated;


CREATE OR REPLACE FUNCTION public.get_admin_scope(p_admin_id uuid)
RETURNS TABLE(unit_id uuid, depth int)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE scope AS (
    SELECT u.id AS uid, 0 AS d
    FROM public.units u
    JOIN public.people_units pu ON pu.unit_id = u.id
    WHERE pu.person_id = p_admin_id
      AND pu.role IN ('admin', 'lead')

    UNION ALL

    SELECT u.id, s.d + 1
    FROM public.units u
    JOIN scope s ON u.parent_id = s.uid
  )
  SELECT DISTINCT uid AS unit_id, d AS depth FROM scope;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_admin_scope(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.can_manage_unit(p_unit_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    public.is_global_admin()
    OR
    EXISTS (
      SELECT 1 FROM public.get_admin_scope(auth.uid())
      WHERE unit_id = p_unit_id
    );
$$;
GRANT EXECUTE ON FUNCTION public.can_manage_unit(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.touch_last_active()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.profiles SET last_active_at = now() WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.touch_last_active() TO authenticated;


CREATE OR REPLACE FUNCTION public.clear_must_change_password(p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() = p_target_id OR public.is_global_admin() THEN
    UPDATE public.profiles SET must_change_password = false WHERE id = p_target_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.clear_must_change_password(uuid) TO authenticated;


-- ── 11. people_units ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.people_units (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  unit_id    uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member',
  is_primary boolean NOT NULL DEFAULT false,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(person_id, unit_id)
);

CREATE INDEX IF NOT EXISTS people_units_person_id_idx ON public.people_units(person_id);
CREATE INDEX IF NOT EXISTS people_units_unit_id_idx   ON public.people_units(unit_id);

ALTER TABLE public.people_units ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "people_units_read_all" ON public.people_units FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "people_units_insert_own" ON public.people_units FOR INSERT TO authenticated WITH CHECK (person_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "people_units_update_own" ON public.people_units FOR UPDATE TO authenticated USING (person_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "people_units_delete_own" ON public.people_units FOR DELETE TO authenticated USING (person_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "people_units_insert_admin" ON public.people_units FOR INSERT TO authenticated
    WITH CHECK (public.is_global_admin() OR unit_id IN (SELECT unit_id FROM public.get_admin_scope(auth.uid())));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "people_units_update_admin" ON public.people_units FOR UPDATE TO authenticated
    USING (public.is_global_admin() OR unit_id IN (SELECT unit_id FROM public.get_admin_scope(auth.uid())));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "people_units_delete_admin" ON public.people_units FOR DELETE TO authenticated
    USING (public.is_global_admin() OR unit_id IN (SELECT unit_id FROM public.get_admin_scope(auth.uid())));
EXCEPTION WHEN duplicate_object THEN null; END $$;


-- ── 12. visible_units_for_person (needs people_units to exist first) ─────────

CREATE OR REPLACE FUNCTION public.visible_units_for_person(p_person_id uuid)
RETURNS TABLE(unit_id uuid) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH RECURSIVE visible AS (
    SELECT pu.unit_id AS uid
    FROM public.people_units pu
    WHERE pu.person_id = p_person_id

    UNION ALL

    SELECT u.parent_id AS uid
    FROM public.units u
    JOIN visible v ON u.id = v.uid
    WHERE u.parent_id IS NOT NULL
  )
  SELECT DISTINCT uid FROM visible;
$$;
GRANT EXECUTE ON FUNCTION public.visible_units_for_person(uuid) TO authenticated;


-- ── 13. Fix get_analytics: make robust when tables may be empty ───────────

CREATE OR REPLACE FUNCTION public.get_analytics(
  p_cycle_id  uuid,
  p_viewer_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_visible_units  uuid[];
  v_org_conf       numeric;
  v_ci_submitted   int;
  v_ci_total       int;
  v_aligned        int;
  v_total_objs     int;
  v_kpi_on_track   int;
  v_kpi_at_risk    int;
  v_kpi_off_plan   int;
  v_weekly_conf    jsonb;
  v_team_ci        jsonb;
  v_cycle_history  jsonb;
  v_alignment      jsonb;
  v_unaligned      jsonb;
  v_leaderboard    jsonb;
  v_ci_week        int;
  v_ci_year        int;
BEGIN
  v_ci_week := EXTRACT(WEEK FROM now())::int;
  v_ci_year := EXTRACT(YEAR FROM now())::int;

  -- Visible units for this viewer
  SELECT ARRAY(SELECT unit_id FROM public.visible_units_for_person(p_viewer_id))
  INTO v_visible_units;

  IF v_visible_units IS NULL OR array_length(v_visible_units, 1) IS NULL THEN
    -- Fall back to all units if person has no memberships (e.g., global admin with no unit)
    SELECT ARRAY(SELECT id FROM public.units)
    INTO v_visible_units;
  END IF;

  -- 1. Org confidence avg
  SELECT COALESCE(AVG(kr.confidence), 0)
  INTO v_org_conf
  FROM public.key_results kr
  JOIN public.objectives o ON o.id = kr.objective_id
  WHERE o.cycle_id = p_cycle_id
    AND kr.confidence IS NOT NULL;

  -- 2. Check-in rate this week
  SELECT
    COALESCE(COUNT(DISTINCT c.person_id), 0),
    COALESCE(COUNT(DISTINCT pu.person_id), 0)
  INTO v_ci_submitted, v_ci_total
  FROM public.people_units pu
  LEFT JOIN public.checkins c ON
    c.person_id = pu.person_id
    AND COALESCE(c.week_number, 0) = v_ci_week
    AND COALESCE(c.year, 0) = v_ci_year
  WHERE pu.unit_id = ANY(v_visible_units);

  -- 3. Alignment rate
  SELECT
    COALESCE(COUNT(*) FILTER (WHERE parent_objective_id IS NOT NULL), 0),
    COALESCE(COUNT(*), 0)
  INTO v_aligned, v_total_objs
  FROM public.objectives
  WHERE cycle_id = p_cycle_id;

  -- 4. KPI health (handle missing kpis table gracefully)
  BEGIN
    SELECT
      COALESCE(COUNT(*) FILTER (WHERE k.actual >= k.plan * 0.95), 0),
      COALESCE(COUNT(*) FILTER (WHERE k.actual >= k.plan * 0.70 AND k.actual < k.plan * 0.95), 0),
      COALESCE(COUNT(*) FILTER (WHERE k.actual < k.plan * 0.70), 0)
    INTO v_kpi_on_track, v_kpi_at_risk, v_kpi_off_plan
    FROM public.kpis k
    WHERE k.cycle_id = p_cycle_id OR k.cycle_id IS NULL;
  EXCEPTION WHEN undefined_table THEN
    v_kpi_on_track := 0; v_kpi_at_risk := 0; v_kpi_off_plan := 0;
  END;

  -- 5. Weekly confidence by unit (via confidence_logs if available)
  BEGIN
    SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]')
    INTO v_weekly_conf
    FROM (
      SELECT cl.week, o.unit_id::text AS unit_id, ROUND(AVG(cl.value)::numeric, 1) AS avg_conf
      FROM public.confidence_logs cl
      JOIN public.key_results kr ON kr.id = cl.key_result_id
      JOIN public.objectives o ON o.id = kr.objective_id
      WHERE o.cycle_id = p_cycle_id
        AND cl.year = v_ci_year
        AND o.unit_id IS NOT NULL
      GROUP BY cl.week, o.unit_id
      ORDER BY cl.week
    ) r;
  EXCEPTION WHEN undefined_table THEN
    v_weekly_conf := '[]';
  END;

  IF v_weekly_conf IS NULL THEN v_weekly_conf := '[]'; END IF;

  -- 6. Alignment by level
  BEGIN
    SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]')
    INTO v_alignment
    FROM (
      SELECT
        ol.depth AS level,
        ol.name  AS level_name,
        COALESCE(COUNT(o.id) FILTER (WHERE o.parent_objective_id IS NOT NULL), 0) AS aligned,
        COALESCE(COUNT(o.id), 0) AS total
      FROM public.org_levels ol
      LEFT JOIN public.objectives o ON o.level_id = ol.id AND o.cycle_id = p_cycle_id
      GROUP BY ol.depth, ol.name
      ORDER BY ol.depth
    ) r;
  EXCEPTION WHEN undefined_table THEN
    v_alignment := '[]';
  END;

  IF v_alignment IS NULL THEN v_alignment := '[]'; END IF;

  -- 7. Unaligned objectives
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title)), '[]')
  INTO v_unaligned
  FROM public.objectives o
  WHERE o.cycle_id = p_cycle_id
    AND o.parent_objective_id IS NULL;

  IF v_unaligned IS NULL THEN v_unaligned := '[]'; END IF;

  -- 8. Cycle history
  BEGIN
    SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]')
    INTO v_cycle_history
    FROM (
      SELECT c.label, COALESCE(AVG(orv.final_score), 0) AS score
      FROM public.cycles c
      LEFT JOIN public.objective_reviews orv ON orv.cycle_id = c.id
      WHERE c.status IN ('archived', 'active')
      GROUP BY c.id, c.label, c.start_date
      ORDER BY c.start_date
      LIMIT 6
    ) r;
  EXCEPTION WHEN undefined_column THEN
    SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]')
    INTO v_cycle_history
    FROM (
      SELECT c.label, 0.0 AS score
      FROM public.cycles c
      ORDER BY c.start_date
      LIMIT 6
    ) r;
  WHEN undefined_table THEN
    v_cycle_history := '[]';
  END;

  IF v_cycle_history IS NULL THEN v_cycle_history := '[]'; END IF;

  -- 9. Team check-in completion
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]')
  INTO v_team_ci
  FROM (
    SELECT
      u.name AS unit_name,
      COUNT(DISTINCT pu.person_id) AS total_members,
      COUNT(DISTINCT c.person_id)  AS submitted
    FROM public.units u
    JOIN public.people_units pu ON pu.unit_id = u.id
    LEFT JOIN public.checkins c ON
      c.person_id = pu.person_id
      AND COALESCE(c.week_number, 0) = v_ci_week
      AND COALESCE(c.year, 0) = v_ci_year
    WHERE u.id = ANY(v_visible_units)
    GROUP BY u.id, u.name
    ORDER BY u.name
  ) r;

  IF v_team_ci IS NULL THEN v_team_ci := '[]'; END IF;

  -- 10. Leaderboard
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]')
  INTO v_leaderboard
  FROM (
    SELECT
      u.name AS unit_name,
      COUNT(DISTINCT pu.person_id) AS member_count,
      COALESCE(AVG(CASE WHEN COALESCE(c.week_number,0) = v_ci_week THEN c.confidence END), 0) AS avg_conf,
      COALESCE(ROUND(100.0 * COUNT(DISTINCT CASE WHEN COALESCE(c.week_number,0) = v_ci_week THEN c.person_id END)
            / NULLIF(COUNT(DISTINCT pu.person_id), 0)), 0) AS ci_rate,
      COUNT(DISTINCT o.id) FILTER (WHERE o.parent_objective_id IS NOT NULL)::int AS aligned_objs,
      COUNT(DISTINCT o.id)::int AS total_objs
    FROM public.units u
    JOIN public.people_units pu ON pu.unit_id = u.id
    LEFT JOIN public.checkins c ON c.person_id = pu.person_id
    LEFT JOIN public.objectives o ON o.owner_id = pu.person_id AND o.cycle_id = p_cycle_id
    WHERE u.id = ANY(v_visible_units)
    GROUP BY u.id, u.name
    ORDER BY avg_conf DESC
    LIMIT 20
  ) r;

  IF v_leaderboard IS NULL THEN v_leaderboard := '[]'; END IF;

  RETURN jsonb_build_object(
    'orgConfidence',  ROUND(v_org_conf::numeric, 1),
    'checkInRate',    jsonb_build_object('submitted', v_ci_submitted, 'total', v_ci_total),
    'alignmentRate',  CASE WHEN v_total_objs > 0 THEN ROUND(100.0 * v_aligned / v_total_objs) ELSE 0 END,
    'kpiHealth',      jsonb_build_object('onTrack', v_kpi_on_track, 'atRisk', v_kpi_at_risk, 'offPlan', v_kpi_off_plan),
    'weeklyConf',     v_weekly_conf,
    'teamCheckIns',   v_team_ci,
    'cycleHistory',   v_cycle_history,
    'alignment',      v_alignment,
    'unaligned',      v_unaligned,
    'leaderboard',    v_leaderboard
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_analytics(uuid, uuid) TO authenticated;


-- ── 14. Mark current user as global admin ────────────────────────────────────
-- Run once: set the first/only user as global admin.
-- In production, replace with a specific email or user ID.

UPDATE public.profiles
SET is_global_admin = true
WHERE id = (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1);

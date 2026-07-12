-- =============================================================================
-- Security fix: cross-tenant data leaks in SECURITY DEFINER functions
-- =============================================================================
-- Audit findings (2026-07-12):
--
-- 1. get_analytics() — three gaps:
--    a) KPI health: `OR k.cycle_id IS NULL` pulled in kpis from ALL orgs with
--       no org_id filter when k.cycle_id IS NULL (null = "global" kpis read
--       across tenants). Confirmed live cross-tenant exposure.
--    b) Cycle history: `WHERE c.status = 'archived' OR c.id = p_cycle_id` had
--       NO org_id filter — returned archived cycles from every org on the
--       platform to every caller.
--    c) All queries relied solely on p_cycle_id for scoping with no early
--       validation that p_cycle_id belongs to the caller's org, making the
--       entire function exploitable by passing another org's cycle_id.
--    Fix: derive v_org_id from p_viewer_id at function start; add explicit
--    org_id filters to every multi-tenant query; remove `OR k.cycle_id IS NULL`.
--
-- 2. lock_cycle_scores() — is_global_admin() guards the call but does not
--    prevent a global admin from passing p_cycle_id from another organisation.
--    Pattern established by admin_set_user_status (also global-admin-gated) is
--    to additionally scope writes to my_org_id(). Without that, a global admin
--    could archive and carry-forward another org's cycle.
--    Fix: validate p_cycle_id.org_id = my_org_id() at function start.
--
-- 3. notify_review_open() — same pattern as lock_cycle_scores: global-admin
--    guard exists but p_cycle_id is not validated to belong to caller's org.
--    Fix: validate p_cycle_id.org_id = my_org_id() at function start.
--
-- Note: seed_default_permissions() was flagged by initial scan but is SAFE —
-- GRANT EXECUTE is to service_role only, not to authenticated, so end users
-- cannot call it.
-- =============================================================================


-- ── 1. get_analytics (full corrected body) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_analytics(
  p_cycle_id  uuid,
  p_viewer_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_org_id        uuid;
  v_visible_units uuid[];

  v_org_conf      numeric;
  v_ci_submitted  int;
  v_ci_total      int;
  v_aligned       int;
  v_total_objs    int;
  v_kpi_on_track  int;
  v_kpi_at_risk   int;
  v_kpi_off_plan  int;

  v_weekly_conf   jsonb;
  v_team_ci       jsonb;
  v_cycle_history jsonb;
  v_alignment     jsonb;
  v_unaligned     jsonb;
  v_leaderboard   jsonb;
BEGIN
  -- Derive org_id from the viewer's profile.
  -- Every subsequent query is filtered by this value so a caller cannot
  -- access another org's data by passing a foreign cycle_id.
  SELECT org_id INTO v_org_id
  FROM public.profiles
  WHERE id = p_viewer_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'analytics: viewer % has no org_id', p_viewer_id;
  END IF;

  -- Validate that the requested cycle belongs to the viewer's org.
  IF NOT EXISTS (
    SELECT 1 FROM public.cycles
    WHERE id = p_cycle_id AND org_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'analytics: cycle % does not belong to org %', p_cycle_id, v_org_id;
  END IF;

  -- Visible units for this viewer (empty set → queries below return nothing, not all units)
  SELECT ARRAY(SELECT unit_id FROM public.visible_units_for_person(p_viewer_id))
  INTO v_visible_units;

  -- 1. Org confidence avg (avg of latest checkin confidence per KR in cycle)
  SELECT COALESCE(AVG(kr.confidence), 0)
  INTO v_org_conf
  FROM public.key_results kr
  JOIN public.objectives o ON o.id = kr.objective_id
  WHERE o.cycle_id = p_cycle_id
    AND o.org_id   = v_org_id
    AND kr.confidence IS NOT NULL;

  -- 2. Check-in rate this ISO week
  SELECT
    COUNT(DISTINCT c.person_id),
    COUNT(DISTINCT pu.person_id)
  INTO v_ci_submitted, v_ci_total
  FROM public.people_units pu
  LEFT JOIN public.checkins c ON
    c.person_id = pu.person_id
    AND c.week_number = EXTRACT(WEEK FROM now())::int
    AND c.year = EXTRACT(YEAR FROM now())::int
  WHERE pu.unit_id = ANY(v_visible_units)
    AND pu.org_id  = v_org_id;

  -- 3. Alignment rate (scoped to org via both cycle_id and org_id)
  SELECT
    COUNT(*) FILTER (WHERE parent_objective_id IS NOT NULL),
    COUNT(*)
  INTO v_aligned, v_total_objs
  FROM public.objectives
  WHERE cycle_id = p_cycle_id
    AND org_id   = v_org_id;

  -- 4. KPI health
  -- `OR k.cycle_id IS NULL` removed: it previously matched kpis across all
  -- orgs when cycle_id was null, leaking cross-tenant KPI counts.
  SELECT
    COUNT(*) FILTER (WHERE k.actual >= k.plan * 0.95),
    COUNT(*) FILTER (WHERE k.actual >= k.plan * 0.70 AND k.actual < k.plan * 0.95),
    COUNT(*) FILTER (WHERE k.actual < k.plan * 0.70)
  INTO v_kpi_on_track, v_kpi_at_risk, v_kpi_off_plan
  FROM public.kpis k
  WHERE k.org_id   = v_org_id
    AND k.cycle_id = p_cycle_id;

  -- 5. Weekly confidence by unit (last 13 weeks from confidence_logs)
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]')
  INTO v_weekly_conf
  FROM (
    SELECT cl.week, u.id::text AS unit_id, ROUND(AVG(cl.value)::numeric, 1) AS avg_conf
    FROM public.confidence_logs cl
    JOIN public.key_results kr ON kr.id = cl.key_result_id
    JOIN public.objectives o ON o.id = kr.objective_id
    JOIN public.units u ON u.id = ANY(v_visible_units) AND u.org_id = v_org_id
    WHERE o.cycle_id = p_cycle_id
      AND o.org_id   = v_org_id
      AND cl.year    = EXTRACT(YEAR FROM now())::int
    GROUP BY cl.week, u.id
    ORDER BY cl.week
  ) r;

  -- 6. Alignment by level (using objectives.level_id)
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]')
  INTO v_alignment
  FROM (
    SELECT
      ol.depth AS level,
      ol.name  AS level_name,
      COUNT(o.id) FILTER (WHERE o.parent_objective_id IS NOT NULL) AS aligned,
      COUNT(o.id) AS total
    FROM public.objectives o
    JOIN public.org_levels ol ON ol.id = o.level_id
    WHERE o.cycle_id = p_cycle_id
      AND o.org_id   = v_org_id
    GROUP BY ol.depth, ol.name
    ORDER BY ol.depth
  ) r;

  -- 7. Unaligned objectives
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title)), '[]')
  INTO v_unaligned
  FROM public.objectives o
  WHERE o.cycle_id = p_cycle_id
    AND o.org_id   = v_org_id
    AND o.parent_objective_id IS NULL;

  -- 8. Cycle history (archived cycles with avg score) — org-scoped.
  -- Previously had no org_id filter, returning every org's archived cycles.
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]')
  INTO v_cycle_history
  FROM (
    SELECT c.label, COALESCE(AVG(orv.final_score), 0) AS score
    FROM public.cycles c
    LEFT JOIN public.objective_reviews orv ON orv.cycle_id = c.id
    WHERE (c.status = 'archived' OR c.id = p_cycle_id)
      AND c.org_id = v_org_id
    GROUP BY c.id, c.label, c.start_date
    ORDER BY c.start_date
    LIMIT 6
  ) r;

  -- 9. Team check-in completion (filtered by visible units, already org-scoped)
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
      AND c.week_number = EXTRACT(WEEK FROM now())::int
      AND c.year = EXTRACT(YEAR FROM now())::int
    WHERE u.id     = ANY(v_visible_units)
      AND u.org_id = v_org_id
    GROUP BY u.id, u.name
    ORDER BY u.name
  ) r;

  -- 10. Leaderboard
  SELECT COALESCE(jsonb_agg(row_to_json(r)), '[]')
  INTO v_leaderboard
  FROM (
    SELECT
      u.name AS unit_name,
      COUNT(DISTINCT pu.person_id) AS member_count,
      COALESCE(AVG(CASE WHEN c.week_number = EXTRACT(WEEK FROM now())::int THEN c.confidence END), 0) AS avg_conf,
      ROUND(100.0 * COUNT(DISTINCT CASE WHEN c.week_number = EXTRACT(WEEK FROM now())::int THEN c.person_id END)
            / NULLIF(COUNT(DISTINCT pu.person_id), 0)) AS ci_rate,
      COUNT(DISTINCT o.id) FILTER (WHERE o.parent_objective_id IS NOT NULL)::int AS aligned_objs,
      COUNT(DISTINCT o.id)::int AS total_objs
    FROM public.units u
    JOIN public.people_units pu ON pu.unit_id = u.id
    LEFT JOIN public.checkins c ON c.person_id = pu.person_id
    LEFT JOIN public.objectives o ON o.owner_id = pu.person_id
      AND o.cycle_id = p_cycle_id
      AND o.org_id   = v_org_id
    WHERE u.id     = ANY(v_visible_units)
      AND u.org_id = v_org_id
    GROUP BY u.id, u.name
    ORDER BY avg_conf DESC
    LIMIT 20
  ) r;

  RETURN jsonb_build_object(
    'orgConfidence',   ROUND(v_org_conf::numeric, 1),
    'checkInRate',     jsonb_build_object('submitted', v_ci_submitted, 'total', v_ci_total),
    'alignmentRate',   CASE WHEN v_total_objs > 0 THEN ROUND(100.0 * v_aligned / v_total_objs) ELSE 0 END,
    'kpiHealth',       jsonb_build_object('onTrack', v_kpi_on_track, 'atRisk', v_kpi_at_risk, 'offPlan', v_kpi_off_plan),
    'weeklyConf',      v_weekly_conf,
    'teamCheckIns',    v_team_ci,
    'cycleHistory',    v_cycle_history,
    'alignment',       v_alignment,
    'unaligned',       v_unaligned,
    'leaderboard',     v_leaderboard
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.get_analytics(uuid, uuid) TO authenticated;


-- ── 2. lock_cycle_scores (add org validation on p_cycle_id) ─────────────────

CREATE OR REPLACE FUNCTION public.lock_cycle_scores(
  p_cycle_id      uuid,
  p_next_cycle_id uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec RECORD;
  new_obj_id uuid;
  kr_rec RECORD;
BEGIN
  -- Only global admins can lock
  IF NOT public.is_global_admin() THEN
    RAISE EXCEPTION 'Only global admins can lock cycle scores';
  END IF;

  -- Validate cycle belongs to caller's org (global admin is org-scoped,
  -- matching the pattern in admin_set_user_status which also adds my_org_id()).
  IF NOT EXISTS (
    SELECT 1 FROM public.cycles
    WHERE id = p_cycle_id AND org_id = public.my_org_id()
  ) THEN
    RAISE EXCEPTION 'lock_cycle_scores: cycle % does not belong to your organisation', p_cycle_id;
  END IF;

  -- Also validate next cycle if provided
  IF p_next_cycle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cycles
    WHERE id = p_next_cycle_id AND org_id = public.my_org_id()
  ) THEN
    RAISE EXCEPTION 'lock_cycle_scores: next cycle % does not belong to your organisation', p_next_cycle_id;
  END IF;

  -- 1. Copy manager scores → final (or auto-scores where no manager score exists)
  INSERT INTO public.key_result_scores (key_result_id, cycle_id, reviewer_id, stage, score, scored_at)
  SELECT DISTINCT ON (krs.key_result_id)
    krs.key_result_id,
    p_cycle_id,
    krs.reviewer_id,
    'final',
    krs.score,
    now()
  FROM public.key_result_scores krs
  WHERE krs.cycle_id = p_cycle_id
    AND krs.stage IN ('manager', 'self')
  ORDER BY krs.key_result_id,
           CASE krs.stage WHEN 'manager' THEN 0 ELSE 1 END
  ON CONFLICT (key_result_id, reviewer_id, stage) DO UPDATE SET score = EXCLUDED.score, scored_at = now();

  -- 2. Write final_score back to key_results
  UPDATE public.key_results kr
  SET final_score = s.score
  FROM public.key_result_scores s
  WHERE s.key_result_id = kr.id
    AND s.cycle_id = p_cycle_id
    AND s.stage = 'final';

  -- 3. Compute and write objective final_score (avg of KR final scores)
  UPDATE public.objectives obj
  SET final_score = (
    SELECT AVG(kr.final_score)
    FROM public.key_results kr
    WHERE kr.objective_id = obj.id
      AND kr.final_score IS NOT NULL
  )
  WHERE obj.cycle_id = p_cycle_id
    AND obj.org_id   = public.my_org_id();

  -- 4. Set cycle status to archived
  UPDATE public.cycles
  SET status = 'archived'
  WHERE id = p_cycle_id AND org_id = public.my_org_id();

  -- 5. Carry forward if next cycle provided
  IF p_next_cycle_id IS NOT NULL THEN
    FOR rec IN
      SELECT o.id AS obj_id, o.title, o.owner_id, o.team_id, o.unit_id, o.level_id,
             o.parent_objective_id, or2.carry_forward
      FROM public.objectives o
      JOIN public.objective_reviews or2
        ON or2.objective_id = o.id AND or2.cycle_id = p_cycle_id AND or2.stage = 'final'
      WHERE o.cycle_id = p_cycle_id
        AND o.org_id   = public.my_org_id()
        AND or2.carry_forward IN ('yes','partial')
    LOOP
      -- Create new objective in next cycle
      INSERT INTO public.objectives (
        title, owner_id, team_id, unit_id, level_id,
        cycle_id, parent_objective_id, status
      ) VALUES (
        rec.title, rec.owner_id, rec.team_id, rec.unit_id, rec.level_id,
        p_next_cycle_id, rec.obj_id, 'on_track'
      )
      RETURNING id INTO new_obj_id;

      -- Copy KRs (all for 'yes', only score < 0.7 for 'partial')
      FOR kr_rec IN
        SELECT kr.title, kr.target_type, kr.target_value, kr.unit, kr.owner_id, kr.direction
        FROM public.key_results kr
        WHERE kr.objective_id = rec.obj_id
          AND (
            rec.carry_forward = 'yes'
            OR (rec.carry_forward = 'partial' AND (kr.final_score IS NULL OR kr.final_score < 0.7))
          )
      LOOP
        INSERT INTO public.key_results (
          objective_id, title, target_type, target_value, current_value, unit, owner_id, direction
        ) VALUES (
          new_obj_id, kr_rec.title, kr_rec.target_type, kr_rec.target_value, 0,
          kr_rec.unit, kr_rec.owner_id, kr_rec.direction
        );
      END LOOP;

      -- Link original KR back to new cycle
      UPDATE public.key_results SET carry_forward_to_cycle_id = p_next_cycle_id
      WHERE objective_id = rec.obj_id;
    END LOOP;

    -- 6. Notify owners of carried-forward objectives
    INSERT INTO public.notifications (person_id, type, title, body)
    SELECT DISTINCT o.owner_id,
      'cycle_archived',
      'Cycle closed — objectives carried forward',
      'Some of your objectives have been carried into the next cycle. Check your new objectives.'
    FROM public.objectives o
    JOIN public.objective_reviews or2
      ON or2.objective_id = o.id AND or2.cycle_id = p_cycle_id AND or2.stage = 'final'
    WHERE o.cycle_id = p_cycle_id
      AND o.org_id   = public.my_org_id()
      AND or2.carry_forward IN ('yes','partial')
      AND o.owner_id IS NOT NULL;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lock_cycle_scores(uuid, uuid) TO authenticated;


-- ── 3. notify_review_open (add org validation on p_cycle_id) ────────────────

CREATE OR REPLACE FUNCTION public.notify_review_open(p_cycle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  cycle_label text;
  close_date  text;
BEGIN
  IF NOT public.is_global_admin() THEN
    RAISE EXCEPTION 'Only global admins can open review';
  END IF;

  -- Validate cycle belongs to caller's org
  IF NOT EXISTS (
    SELECT 1 FROM public.cycles
    WHERE id = p_cycle_id AND org_id = public.my_org_id()
  ) THEN
    RAISE EXCEPTION 'notify_review_open: cycle % does not belong to your organisation', p_cycle_id;
  END IF;

  SELECT label, TO_CHAR(review_closes_at, 'Mon DD')
  INTO cycle_label, close_date
  FROM public.cycles WHERE id = p_cycle_id;

  UPDATE public.cycles
  SET status = 'reviewing'
  WHERE id = p_cycle_id AND org_id = public.my_org_id();

  -- Notify all KR owners who have KRs in objectives for this cycle
  INSERT INTO public.notifications (person_id, type, title, body)
  SELECT DISTINCT kr.owner_id,
    'review_open',
    cycle_label || ' review is open — score your OKRs',
    'Self-assessment is due by ' || COALESCE(close_date, 'end of cycle') || '. Score your key results now.'
  FROM public.key_results kr
  JOIN public.objectives obj ON obj.id = kr.objective_id
  WHERE obj.cycle_id = p_cycle_id
    AND obj.org_id   = public.my_org_id()
    AND kr.owner_id IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_review_open(uuid) TO authenticated;

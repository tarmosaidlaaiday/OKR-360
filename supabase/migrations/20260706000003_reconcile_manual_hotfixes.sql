-- Formalises every manual fix applied via the SQL Editor on 2026-07-06
-- that is not captured by the three other migrations created that day
-- (20260706000001 – cycles constraint, 20260706000002 – color columns).
--
-- Root cause of all items below: migration 20260515000004_review_cycles.sql
-- was recorded as applied in supabase_migrations tracking but individual
-- ALTER TABLE statements within it failed silently (e.g. because a prior
-- version of the table already had some columns from a different path, or
-- because a previous version of the migration script ran without IF NOT
-- EXISTS guards).  The net effect was production columns missing despite
-- the migration being marked applied.
--
-- Every statement here uses ADD COLUMN IF NOT EXISTS so it is safe to run
-- on any database regardless of which columns already landed through which
-- path.  Run order within the file matches the dependency graph (no
-- forward FKs).

-- ── key_results: columns added by review-cycle scoring logic ─────────────────

ALTER TABLE public.key_results
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'up'
    CHECK (direction IN ('up', 'down')),
  ADD COLUMN IF NOT EXISTS final_score numeric
    CHECK (final_score >= 0 AND final_score <= 1),
  ADD COLUMN IF NOT EXISTS carry_forward_to_cycle_id uuid
    REFERENCES public.cycles(id) ON DELETE SET NULL;

-- ── objectives: final_score from review-cycle scoring ────────────────────────

ALTER TABLE public.objectives
  ADD COLUMN IF NOT EXISTS final_score numeric
    CHECK (final_score >= 0 AND final_score <= 1);

-- ── profiles.color — not in any prior migration, added manually 2026-07-06 ───
-- Also in 20260706000002_reconcile_schema_drift.sql; duplicated here so
-- this file is a self-contained record of everything fixed on that date.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#6366f1';

-- ── teams.color — same situation as profiles.color ────────────────────────────

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#6366f1';

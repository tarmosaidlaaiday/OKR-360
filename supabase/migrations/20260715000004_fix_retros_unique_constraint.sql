-- Fix retros: add missing UNIQUE (person_id, week_number, year) constraint.
--
-- ROOT CAUSE: upsertRetro() uses onConflict: 'person_id,week_number,year' which
-- requires an actual UNIQUE constraint in Postgres. The retros table was created
-- in the missing_tables_hotfix migration with only PRIMARY KEY (id) — no unique
-- constraint — so every retro save has been failing 100% of the time.
--
-- Also adds UNIQUE (key_result_id, week, year) to confidence_logs idempotently,
-- which the sync_kr_on_checkin trigger's ON CONFLICT clause depends on but was
-- never explicitly constrained (table defined in schema-cadence.sql without it).
--
-- ONCONFLICT AUDIT SUMMARY (all 11 occurrences in src/):
--   retros                  person_id,week_number,year          MISSING → FIXED HERE
--   confidence_logs         key_result_id,week,year             UNCERTAIN → ADDED HERE (idempotent)
--   notification_preferences person_id,type                     OK (PRIMARY KEY covers it)
--   checkins                key_result_id,person_id,week_number,year OK
--   kpi_snapshots           kpi_id,week_number,year             OK
--   objective_reviews       objective_id,reviewer_id,stage      OK
--   key_result_scores       key_result_id,reviewer_id,stage     OK
--   pending_approvals       person_id                           OK
--   people_units            person_id,unit_id                   OK

-- Step 1: Remove duplicate retro rows before adding the constraint.
-- Keep only the row with the latest id (by text sort) per (person_id,week_number,year).
-- In practice the table is new and empty, but this makes the migration safe to run
-- even if there are rows from repeated failed INSERT fallbacks.
DELETE FROM public.retros
WHERE id NOT IN (
  SELECT DISTINCT ON (person_id, week_number, year) id
  FROM public.retros
  WHERE person_id IS NOT NULL
  ORDER BY person_id, week_number, year, created_at DESC NULLS LAST, id DESC
);

-- Step 2: Add the constraint the upsert depends on.
DO $$ BEGIN
  ALTER TABLE public.retros
    ADD CONSTRAINT retros_person_week_year_key UNIQUE (person_id, week_number, year);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Step 3: Add UNIQUE to confidence_logs if it doesn't already exist.
-- The trigger uses ON CONFLICT (key_result_id, week, year) DO UPDATE which
-- also requires this constraint.
DO $$ BEGIN
  ALTER TABLE public.confidence_logs
    ADD CONSTRAINT confidence_logs_kr_week_year_key UNIQUE (key_result_id, week, year);
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_table THEN null; WHEN undefined_column THEN null; END $$;

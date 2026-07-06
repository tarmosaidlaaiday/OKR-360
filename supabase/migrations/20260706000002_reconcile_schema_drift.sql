-- Reconcile schema drift: columns referenced by frontend queries that were
-- never added to the database via migrations.  All statements use
-- ADD COLUMN IF NOT EXISTS so this is safe to re-run on databases where
-- some columns already exist (e.g. after manually applying an earlier fix).

-- ── 1. teams.color ────────────────────────────────────────────────────────────
-- Queried as team:teams(id, name, color) in every objectives hook.
-- Missing column makes the entire PostgREST response an error, silently
-- dropping all objectives from the UI.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#6366f1';

-- ── 2. profiles.color ─────────────────────────────────────────────────────────
-- Queried as owner:profiles!owner_id(id, full_name, avatar_url, color, role).
-- Same silent failure if absent.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT '#6366f1';

-- ── 3. key_results: owner_id, start_value, confidence ────────────────────────
-- Covered by 20260519000018_key_results_missing_cols.sql, but that migration
-- may not have been applied to the live database.

ALTER TABLE public.key_results
  ADD COLUMN IF NOT EXISTS owner_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidence  int CHECK (confidence IS NULL OR (confidence >= 1 AND confidence <= 10));

CREATE INDEX IF NOT EXISTS idx_key_results_owner ON public.key_results(owner_id);

-- Backfill owner_id from the parent objective's owner_id (idempotent)
UPDATE public.key_results kr
SET owner_id = o.owner_id
FROM public.objectives o
WHERE kr.objective_id = o.id
  AND kr.owner_id IS NULL;

-- ── 4. levels.depth ───────────────────────────────────────────────────────────
-- Covered by 20260528000001_consolidate_levels.sql.
-- Generated column: depth = position (same semantic, different name from old org_levels).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'levels'
      AND column_name  = 'depth'
  ) THEN
    ALTER TABLE public.levels
      ADD COLUMN depth int GENERATED ALWAYS AS (position) STORED;
  END IF;
END $$;

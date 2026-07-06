-- Ensure objectives.level_id → levels(id) FK exists.
-- The original FK was added by 20260528000001_consolidate_levels.sql but
-- the DO-block condition may not have triggered in all environments.
-- This migration is fully idempotent.

-- 1. Drop old FK pointing at org_levels (gone now, but safety net if renamed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name       = 'objectives'
      AND constraint_name  = 'objectives_level_id_fkey'
      AND constraint_type  = 'FOREIGN KEY'
  ) THEN
    -- Check whether it already points to 'levels'; if so, nothing to do.
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.referential_constraints rc
      JOIN information_schema.table_constraints tc
        ON tc.constraint_name = rc.unique_constraint_name
      WHERE rc.constraint_name = 'objectives_level_id_fkey'
        AND tc.table_name      = 'levels'
    ) THEN
      -- Points somewhere else (e.g. org_levels which was dropped) — remove it.
      ALTER TABLE public.objectives DROP CONSTRAINT objectives_level_id_fkey;
    END IF;
  END IF;
END $$;

-- 2. Add FK to levels (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name      = 'objectives'
      AND constraint_name = 'objectives_level_id_fkey'
      AND constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE public.objectives
      ADD CONSTRAINT objectives_level_id_fkey
      FOREIGN KEY (level_id) REFERENCES public.levels(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Reload PostgREST schema cache so the new FK is visible immediately
SELECT pg_notify('pgrst', 'reload schema');

-- ============================================================
-- Consolidate org_levels → levels
-- Drop one_on_one_discussed_objectives (zero frontend refs)
-- Keep permissions (referenced by seed_default_permissions())
-- ============================================================

-- ── STEP 1: Add depth as a generated column to levels ────────────────────────
-- org_levels uses 'depth' (int); levels uses 'position' (int, same semantics).
-- Adding depth as a generated column lets the 4 updated hooks keep the same
-- field name without touching the page-level code that reads obj.level?.depth.

ALTER TABLE public.levels
  ADD COLUMN IF NOT EXISTS depth int GENERATED ALWAYS AS (position) STORED;

-- ── STEP 2: Migrate objectives.level_id from org_levels → levels ─────────────
-- Match rows by name within the same org. Both tables have the same 4 seed
-- rows (Group/Company/Division/Team) per org but with different UUIDs.

DO $$
BEGIN
  -- Drop existing FK to org_levels (auto-named by postgres)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'objectives'
      AND constraint_name = 'objectives_level_id_fkey'
  ) THEN
    ALTER TABLE public.objectives DROP CONSTRAINT objectives_level_id_fkey;
  END IF;
END $$;

-- Remap objective level_id values to the matching levels row (only if org_levels exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'org_levels'
  ) THEN
    UPDATE public.objectives o
    SET level_id = l.id
    FROM public.org_levels ol
    JOIN public.levels l
      ON l.name    = ol.name
     AND (l.org_id = ol.org_id OR (l.org_id IS NULL AND ol.org_id IS NULL))
    WHERE o.level_id = ol.id
      AND o.level_id IS NOT NULL;
  END IF;
END $$;

-- Add new FK to levels (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'objectives' AND constraint_name = 'objectives_level_id_fkey'
      AND constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE public.objectives
      ADD CONSTRAINT objectives_level_id_fkey
      FOREIGN KEY (level_id) REFERENCES public.levels(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── STEP 3: Migrate teams.level_id from org_levels → levels ──────────────────
-- Only applies if teams.level_id column exists (it may not in all environments)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'teams' AND column_name = 'level_id'
  ) THEN
    -- Drop existing FK if present
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE table_name = 'teams'
        AND constraint_name = 'teams_level_id_fkey'
    ) THEN
      ALTER TABLE public.teams DROP CONSTRAINT teams_level_id_fkey;
    END IF;

    -- Remap to levels IDs
    UPDATE public.teams t
    SET level_id = l.id
    FROM public.org_levels ol
    JOIN public.levels l
      ON l.name    = ol.name
     AND (l.org_id = ol.org_id OR (l.org_id IS NULL AND ol.org_id IS NULL))
    WHERE t.level_id = ol.id
      AND t.level_id IS NOT NULL;

    -- Add new FK
    ALTER TABLE public.teams
      ADD CONSTRAINT teams_level_id_fkey
      FOREIGN KEY (level_id) REFERENCES public.levels(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── STEP 4: Drop org_levels triggers, policies, then the table ───────────────

DROP TRIGGER IF EXISTS set_org_id_org_levels ON public.org_levels;
DROP TRIGGER IF EXISTS set_updated_at_org_levels ON public.org_levels;

DROP POLICY IF EXISTS "org_levels_read_all" ON public.org_levels;
DROP POLICY IF EXISTS "org_levels_read_org" ON public.org_levels;
DROP POLICY IF EXISTS "org_levels_write_org" ON public.org_levels;

-- Also drop the function in schema_backfill that references org_levels in a view
-- (safe: the view/function is internal analytics, not frontend-facing)
DROP INDEX IF EXISTS public.idx_org_levels_org_id;

DROP TABLE IF EXISTS public.org_levels CASCADE;

-- ── STEP 5: Drop one_on_one_discussed_objectives (zero frontend refs) ─────────

DROP TABLE IF EXISTS public.one_on_one_discussed_objectives CASCADE;

-- ── STEP 6: Note on permissions table ────────────────────────────────────────
-- permissions table is retained: seed_default_permissions(org_id) inserts into
-- it during org provisioning (service_role only). Zero direct frontend refs.
-- Future: if fine-grained permissions are never built, drop it then.

SELECT 'Consolidation complete: org_levels merged into levels, orphans dropped' AS status;

-- The cycles table was created before the multi-tenancy retrofit and has a
-- UNIQUE (year, quarter) constraint that is not scoped to org_id.  Two orgs
-- picking the same year/quarter (e.g. both default to Q1 2027) collide at
-- the DB level even though RLS correctly scopes what each org can see.
--
-- Fix: drop any existing unique constraint/index on cycles (there is exactly
-- one: UNIQUE (year, quarter), named cycles_year_quarter_key by Postgres
-- default), then recreate it scoped to (org_id, year, quarter).
--
-- Rows with org_id IS NULL are treated as distinct by Postgres UNIQUE (NULLs
-- are never equal), so no special handling is needed for legacy orphan rows.

-- 1. Drop all existing unique constraints on the cycles table
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'cycles'
      AND nsp.nspname = 'public'
      AND con.contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.cycles DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

-- 2. Drop any remaining unique indexes not backed by a constraint (excludes PKs)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT i.indexname
    FROM pg_indexes i
    JOIN pg_class c  ON c.relname = i.indexname
                     AND c.relnamespace = 'public'::regnamespace
    JOIN pg_index pi ON pi.indexrelid = c.oid
    WHERE i.tablename  = 'cycles'
      AND i.schemaname = 'public'
      AND i.indexdef   ILIKE '%UNIQUE%'
      AND NOT pi.indisprimary   -- never touch the PK index
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.indexname);
  END LOOP;
END $$;

-- 3. Add the org-scoped unique constraint (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cycles_org_year_quarter_key'
      AND conrelid = 'public.cycles'::regclass
  ) THEN
    ALTER TABLE public.cycles
      ADD CONSTRAINT cycles_org_year_quarter_key UNIQUE (org_id, year, quarter);
  END IF;
END $$;

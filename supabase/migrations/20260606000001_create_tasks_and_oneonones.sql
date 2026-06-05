-- Create tasks and one_on_ones tables that were in schema-cadence.sql
-- but never added as migrations. Include all columns that later migrations
-- try to ADD IF NOT EXISTS so this is idempotent alongside those migrations.

-- ── tasks ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.tasks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text        NOT NULL,
  owner_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  objective_id    uuid        REFERENCES public.objectives(id) ON DELETE SET NULL,
  objective_label text,
  due_label       text,
  due_date        date,
  done            boolean     NOT NULL DEFAULT false,
  org_id          uuid        REFERENCES public.organisations(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "tasks: read all"
    ON public.tasks FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "tasks: write own"
    ON public.tasks FOR ALL USING (auth.uid() = owner_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── one_on_ones ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.one_on_ones (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  report_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  meeting_date date,
  scheduled_at timestamptz,
  status       text        DEFAULT 'draft' CHECK (status IN ('draft', 'done')),
  cycle_id     uuid        REFERENCES public.cycles(id) ON DELETE SET NULL,
  happiness    integer     CHECK (happiness BETWEEN 1 AND 10),
  summary      text,
  done         boolean     NOT NULL DEFAULT false,
  org_id       uuid        REFERENCES public.organisations(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.one_on_ones ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "one_on_ones: read participants"
    ON public.one_on_ones FOR SELECT
    USING (auth.uid() = manager_id OR auth.uid() = report_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "one_on_ones: write manager"
    ON public.one_on_ones FOR ALL USING (auth.uid() = manager_id);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Backfill scheduled_at from meeting_date for any existing rows
UPDATE public.one_on_ones
SET scheduled_at = meeting_date::timestamptz
WHERE scheduled_at IS NULL AND meeting_date IS NOT NULL;

-- Backfill status from done boolean for any existing rows
UPDATE public.one_on_ones
SET status = CASE WHEN done THEN 'done' ELSE 'draft' END
WHERE status IS NULL;

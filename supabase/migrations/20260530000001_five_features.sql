-- ============================================================
-- Five features: will score, structured retro, pending approval,
-- impact strip data, history browser data
-- ============================================================

-- ── Feature 3: Will score in check-ins ───────────────────────────────────────
ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS will_score smallint
    CONSTRAINT checkins_will_score_range CHECK (will_score IS NULL OR (will_score BETWEEN 1 AND 10)),
  ADD COLUMN IF NOT EXISTS will_action text;

-- ── Feature 5: Structured retro fields (individual, person-based) ─────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'retros'
  ) THEN
    ALTER TABLE public.retros
      ADD COLUMN IF NOT EXISTS person_id    uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
      ADD COLUMN IF NOT EXISTS parking_lot  text,
      ADD COLUMN IF NOT EXISTS top_work     text,
      ADD COLUMN IF NOT EXISTS notes_text   text,
      ADD COLUMN IF NOT EXISTS feedforward  text;

    CREATE UNIQUE INDEX IF NOT EXISTS retros_person_week_year_idx
      ON public.retros(person_id, week_number, year)
      WHERE person_id IS NOT NULL;
  END IF;
END $$;

-- ── Feature 2: Pending approval workflow ─────────────────────────────────────

-- Add require_approval toggle to org_settings
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'org_settings'
  ) THEN
    ALTER TABLE public.org_settings
      ADD COLUMN IF NOT EXISTS require_approval boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- Add awaiting_approval status to profiles
DO $$ BEGIN
  ALTER TABLE public.profiles
    DROP CONSTRAINT IF EXISTS profiles_status_check;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_status_check
    CHECK (status IN ('active', 'pending', 'inactive', 'awaiting_approval'));
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- Pending approvals queue
CREATE TABLE IF NOT EXISTS public.pending_approvals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email        text NOT NULL,
  full_name    text NOT NULL,
  org_id       uuid REFERENCES public.organisations(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id)
);

ALTER TABLE public.pending_approvals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "pending_approvals_org_read" ON public.pending_approvals
    FOR SELECT TO authenticated USING (org_id = public.my_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "pending_approvals_org_write" ON public.pending_approvals
    FOR ALL TO authenticated
    USING (org_id = public.my_org_id())
    WITH CHECK (org_id = public.my_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

SELECT 'five_features migration complete' AS status;

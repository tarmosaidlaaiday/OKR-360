-- Activity log for 1:1 sessions
-- Stores plain-text descriptions of who did what and when,
-- written by the application (not triggers) so messages are human-readable.

CREATE TABLE IF NOT EXISTS public.one_on_one_activity (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  one_on_one_id uuid NOT NULL REFERENCES public.one_on_ones(id) ON DELETE CASCADE,
  actor_id      uuid NOT NULL REFERENCES public.profiles(id),
  description   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.one_on_one_activity ENABLE ROW LEVEL SECURITY;

-- Read and write restricted to the two participants of the session.
-- Mirrors the exact check used by one_on_one_entries' own RLS policy.
DO $$ BEGIN
  CREATE POLICY "oo_activity_participants" ON public.one_on_one_activity
    FOR ALL TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.one_on_ones oo
        WHERE oo.id = one_on_one_activity.one_on_one_id
          AND (oo.manager_id = auth.uid() OR oo.report_id = auth.uid())
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.one_on_ones oo
        WHERE oo.id = one_on_one_activity.one_on_one_id
          AND (oo.manager_id = auth.uid() OR oo.report_id = auth.uid())
      )
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS one_on_one_activity_session_idx
  ON public.one_on_one_activity(one_on_one_id, created_at DESC);

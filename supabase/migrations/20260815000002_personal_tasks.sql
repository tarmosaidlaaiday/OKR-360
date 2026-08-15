-- personal_tasks: freestanding tasks that are not tied to a key result.
-- Used for 1:1-originated tasks and standalone to-dos.
-- Unlike kr_tasks (which chains RLS through key_results→objectives→org_id),
-- this table has its own org_id column so RLS can use a direct comparison —
-- simpler and harder to get wrong.

CREATE TABLE IF NOT EXISTS public.personal_tasks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  title         text NOT NULL,
  status        text NOT NULL DEFAULT 'todo', -- 'todo' | 'in_progress' | 'done'
  assignee_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by    uuid NOT NULL REFERENCES public.profiles(id),
  due_date      date,
  one_on_one_id uuid REFERENCES public.one_on_ones(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.personal_tasks ENABLE ROW LEVEL SECURITY;

-- Auto-update updated_at (reuses the existing trigger function)
CREATE TRIGGER set_personal_tasks_updated_at
  BEFORE UPDATE ON public.personal_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Read: any org member can see all tasks in their org
DO $$ BEGIN
  CREATE POLICY "personal_tasks_read" ON public.personal_tasks
    FOR SELECT TO authenticated
    USING (
      org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Insert: can only create tasks in your own org; created_by must be you
DO $$ BEGIN
  CREATE POLICY "personal_tasks_insert" ON public.personal_tasks
    FOR INSERT TO authenticated
    WITH CHECK (
      org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      AND created_by = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Update: org-scoped; only the assignee or creator can update
DO $$ BEGIN
  CREATE POLICY "personal_tasks_update" ON public.personal_tasks
    FOR UPDATE TO authenticated
    USING (
      org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      AND (assignee_id = auth.uid() OR created_by = auth.uid())
    )
    WITH CHECK (
      org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Delete: org-scoped; only the assignee or creator can delete
DO $$ BEGIN
  CREATE POLICY "personal_tasks_delete" ON public.personal_tasks
    FOR DELETE TO authenticated
    USING (
      org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid())
      AND (assignee_id = auth.uid() OR created_by = auth.uid())
    );
EXCEPTION WHEN duplicate_object THEN null; END $$;

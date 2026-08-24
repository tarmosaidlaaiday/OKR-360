-- Task attachments table
CREATE TABLE IF NOT EXISTS public.task_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kr_task_id      uuid REFERENCES public.kr_tasks(id) ON DELETE CASCADE,
  personal_task_id uuid REFERENCES public.personal_tasks(id) ON DELETE CASCADE,
  file_name       text NOT NULL,
  file_url        text NOT NULL,
  uploaded_by     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_attachments_one_target CHECK (
    (kr_task_id IS NOT NULL)::int + (personal_task_id IS NOT NULL)::int = 1
  )
);

CREATE INDEX IF NOT EXISTS task_attachments_kr_task_idx       ON public.task_attachments(kr_task_id)       WHERE kr_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS task_attachments_personal_task_idx ON public.task_attachments(personal_task_id) WHERE personal_task_id IS NOT NULL;

-- RLS
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read attachments for tasks they can see
CREATE POLICY "task_attachments_read" ON public.task_attachments
  FOR SELECT TO authenticated USING (true);

-- Users can insert attachments for their own uploads
CREATE POLICY "task_attachments_insert" ON public.task_attachments
  FOR INSERT TO authenticated WITH CHECK (uploaded_by = auth.uid());

-- Users can delete their own attachments
CREATE POLICY "task_attachments_delete" ON public.task_attachments
  FOR DELETE TO authenticated USING (uploaded_by = auth.uid());

-- Storage bucket for task attachments (run in Supabase dashboard if not using storage migrations)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('task-attachments', 'task-attachments', false)
-- ON CONFLICT (id) DO NOTHING;

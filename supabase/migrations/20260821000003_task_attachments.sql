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

-- Read: only if the caller's org actually owns the underlying task —
-- derived through kr_tasks -> key_results -> objectives -> org_id for
-- KR-linked tasks, or personal_tasks' own direct org_id column otherwise.
-- The original version of this policy was `USING (true)` — a full
-- cross-tenant read hole — never apply that version.
CREATE POLICY "task_attachments_read" ON public.task_attachments
  FOR SELECT TO authenticated
  USING (
    (kr_task_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.kr_tasks kt
      JOIN public.key_results kr ON kr.id = kt.key_result_id
      JOIN public.objectives o ON o.id = kr.objective_id
      WHERE kt.id = task_attachments.kr_task_id
        AND o.org_id = public.my_org_id()
    ))
    OR
    (personal_task_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.personal_tasks pt
      WHERE pt.id = task_attachments.personal_task_id
        AND pt.org_id = public.my_org_id()
    ))
  );

-- Insert: caller must be the uploader AND the target task must actually
-- belong to the caller's own org (the original version only checked
-- uploaded_by, which doesn't stop attaching a file to a task_id from a
-- different org).
CREATE POLICY "task_attachments_insert" ON public.task_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      (kr_task_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.kr_tasks kt
        JOIN public.key_results kr ON kr.id = kt.key_result_id
        JOIN public.objectives o ON o.id = kr.objective_id
        WHERE kt.id = kr_task_id AND o.org_id = public.my_org_id()
      ))
      OR
      (personal_task_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.personal_tasks pt
        WHERE pt.id = personal_task_id AND pt.org_id = public.my_org_id()
      ))
    )
  );

-- Delete: only the person who uploaded it
CREATE POLICY "task_attachments_delete" ON public.task_attachments
  FOR DELETE TO authenticated USING (uploaded_by = auth.uid());

-- Storage bucket for task attachments — create via the Supabase dashboard
-- (Storage -> New bucket -> "task-attachments", NOT public), then apply
-- policies mirroring the avatars bucket: path-scoped so a user can only
-- write to a path under the task they're actually uploading against.
-- Do not make this bucket's public flag true, and do not use a bare
-- USING (true) on its storage.objects policies either.

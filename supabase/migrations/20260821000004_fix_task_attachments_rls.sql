-- Fix insecure task_attachments RLS policies from migration 20260821000003.
-- That migration was already recorded in schema_migrations before the corrected
-- version was committed, so db push did not re-run it. This migration replaces
-- the two broken policies explicitly.

DROP POLICY IF EXISTS "task_attachments_read"   ON public.task_attachments;
DROP POLICY IF EXISTS "task_attachments_insert" ON public.task_attachments;

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

-- Delete: only the person who uploaded it (was correct in 20260821000003, unchanged)

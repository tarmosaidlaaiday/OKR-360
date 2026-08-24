-- Extend comments to support kr_task_id and personal_task_id
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS kr_task_id uuid REFERENCES public.kr_tasks(id) ON DELETE CASCADE;
ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS personal_task_id uuid REFERENCES public.personal_tasks(id) ON DELETE CASCADE;

-- Update one-target constraint to include all 5 target columns
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_one_target;
ALTER TABLE public.comments ADD CONSTRAINT comments_one_target CHECK (
  (objective_id IS NOT NULL)::int
  + (key_result_id IS NOT NULL)::int
  + (kpi_id IS NOT NULL)::int
  + (kr_task_id IS NOT NULL)::int
  + (personal_task_id IS NOT NULL)::int = 1
);

CREATE INDEX IF NOT EXISTS comments_kr_task_idx      ON public.comments(kr_task_id)      WHERE kr_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS comments_personal_task_idx ON public.comments(personal_task_id) WHERE personal_task_id IS NOT NULL;

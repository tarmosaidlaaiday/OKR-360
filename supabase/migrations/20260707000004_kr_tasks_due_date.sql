ALTER TABLE public.kr_tasks
  ADD COLUMN IF NOT EXISTS due_date date;

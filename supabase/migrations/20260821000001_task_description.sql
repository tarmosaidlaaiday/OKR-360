-- Add nullable description column to task tables
ALTER TABLE public.kr_tasks       ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.personal_tasks ADD COLUMN IF NOT EXISTS description text;

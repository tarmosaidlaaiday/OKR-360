-- Add updated_at to one_on_ones so we can distinguish "originally submitted"
-- from "last edited" for done sessions.
DO $$ BEGIN
  ALTER TABLE public.one_on_ones ADD COLUMN updated_at timestamptz;
EXCEPTION WHEN duplicate_column THEN null; END $$;

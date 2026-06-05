-- Add review tracking columns to cycles that were referenced in code
-- but never added to the live DB table.

ALTER TABLE public.cycles
  ADD COLUMN IF NOT EXISTS review_open_at  timestamptz,
  ADD COLUMN IF NOT EXISTS review_closes_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add per-role submission timestamps to one_on_one_entries.
-- submitted_at (the existing shared column) is kept for backward compatibility
-- with anything that already depends on it. New logic should use these columns.

ALTER TABLE public.one_on_one_entries
  ADD COLUMN IF NOT EXISTS employee_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS manager_submitted_at  timestamptz;

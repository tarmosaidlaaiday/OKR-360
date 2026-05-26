-- Add missing columns to key_results that are referenced by the frontend queries.
-- These columns were assumed to exist but were never added to the schema.

ALTER TABLE public.key_results
  ADD COLUMN IF NOT EXISTS owner_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidence  int CHECK (confidence IS NULL OR (confidence >= 1 AND confidence <= 10));

CREATE INDEX IF NOT EXISTS idx_key_results_owner ON public.key_results(owner_id);

-- Backfill owner_id from the parent objective's owner_id
UPDATE public.key_results kr
SET owner_id = o.owner_id
FROM public.objectives o
WHERE kr.objective_id = o.id
  AND kr.owner_id IS NULL;

-- ── TASK 1: Add period_type + period_number columns ──────────────────────

ALTER TABLE public.cycles
  ADD COLUMN IF NOT EXISTS period_type text NOT NULL DEFAULT 'quarter'
    CHECK (period_type IN ('year', 'half', 'quarter')),
  ADD COLUMN IF NOT EXISTS period_number int NOT NULL DEFAULT 1;

-- Backfill: all existing rows are quarter cycles; copy quarter → period_number
UPDATE public.cycles
  SET period_number = quarter
  WHERE period_type = 'quarter'
    AND quarter IS NOT NULL
    AND quarter BETWEEN 1 AND 4;

-- Drop old org+year+quarter unique constraint (replaced below)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name    = 'cycles'
      AND constraint_name = 'cycles_org_year_quarter_key'
  ) THEN
    ALTER TABLE public.cycles DROP CONSTRAINT cycles_org_year_quarter_key;
  END IF;
END $$;

-- New unique constraint scoped to period_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name    = 'cycles'
      AND constraint_name = 'cycles_org_year_period_key'
  ) THEN
    ALTER TABLE public.cycles
      ADD CONSTRAINT cycles_org_year_period_key
      UNIQUE (org_id, year, period_type, period_number);
  END IF;
END $$;

-- period_number range check per type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name    = 'cycles'
      AND constraint_name = 'cycles_period_number_range_check'
  ) THEN
    ALTER TABLE public.cycles
      ADD CONSTRAINT cycles_period_number_range_check
      CHECK (
        (period_type = 'quarter' AND period_number BETWEEN 1 AND 4) OR
        (period_type = 'half'    AND period_number BETWEEN 1 AND 2) OR
        (period_type = 'year'    AND period_number = 1)
      );
  END IF;
END $$;


-- ── TASK 2: Auto-generate default cycles for new orgs ─────────────────────

CREATE OR REPLACE FUNCTION public.generate_default_cycles(p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_year int := EXTRACT(YEAR FROM now())::int;
  v_cur_q int := EXTRACT(QUARTER FROM now())::int;
  v_q   int;
  v_y   int;
  v_n   int;
BEGIN
  -- Year cycle for current year
  INSERT INTO public.cycles
    (org_id, year, quarter, period_type, period_number, label, start_date, end_date, status)
  VALUES
    (p_org_id, v_year, 1, 'year', 1,
     v_year::text,
     make_date(v_year, 1, 1),
     make_date(v_year, 12, 31),
     'active')
  ON CONFLICT (org_id, year, period_type, period_number) DO NOTHING;

  -- Both halves of current year
  INSERT INTO public.cycles
    (org_id, year, quarter, period_type, period_number, label, start_date, end_date, status)
  VALUES
    (p_org_id, v_year, 1, 'half', 1,
     'H1 ' || v_year,
     make_date(v_year, 1, 1),
     make_date(v_year, 6, 30),
     'active'),
    (p_org_id, v_year, 3, 'half', 2,
     'H2 ' || v_year,
     make_date(v_year, 7, 1),
     make_date(v_year, 12, 31),
     'active')
  ON CONFLICT (org_id, year, period_type, period_number) DO NOTHING;

  -- Current quarter + next 3 quarters (rolling window of 4)
  FOR v_n IN 0..3 LOOP
    v_q := ((v_cur_q - 1 + v_n) % 4) + 1;
    v_y := v_year + (v_cur_q - 1 + v_n) / 4;

    INSERT INTO public.cycles
      (org_id, year, quarter, period_type, period_number, label, start_date, end_date, status)
    VALUES (
      p_org_id,
      v_y,
      v_q,
      'quarter',
      v_q,
      'Q' || v_q || ' ' || v_y,
      make_date(v_y, (v_q - 1) * 3 + 1, 1),
      (make_date(v_y, (v_q - 1) * 3 + 1, 1) + interval '3 months' - interval '1 day')::date,
      CASE WHEN v_y = v_year AND v_q = v_cur_q THEN 'active' ELSE 'draft' END
    )
    ON CONFLICT (org_id, year, period_type, period_number) DO NOTHING;
  END LOOP;
END;
$$;

-- Trigger: fire generate_default_cycles for every new org
CREATE OR REPLACE FUNCTION public.trigger_generate_default_cycles()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.generate_default_cycles(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_org_created_generate_cycles ON public.organisations;
CREATE TRIGGER on_org_created_generate_cycles
  AFTER INSERT ON public.organisations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_generate_default_cycles();

-- One-time backfill: generate defaults for existing orgs that have zero cycles
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM public.organisations o
    WHERE NOT EXISTS (SELECT 1 FROM public.cycles c WHERE c.org_id = o.id)
  LOOP
    PERFORM public.generate_default_cycles(r.id);
  END LOOP;
END $$;

-- Reload PostgREST schema cache
SELECT pg_notify('pgrst', 'reload schema');

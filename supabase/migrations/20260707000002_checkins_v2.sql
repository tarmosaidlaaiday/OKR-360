-- Extend checkins table with new columns for weekly check-in system

ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS week_number int,
  ADD COLUMN IF NOT EXISTS year int,
  ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES public.cycles(id),
  ADD COLUMN IF NOT EXISTS new_value numeric,
  ADD COLUMN IF NOT EXISTS confidence int CHECK (confidence IS NULL OR (confidence >= 1 AND confidence <= 10)),
  ADD COLUMN IF NOT EXISTS has_blocker boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS blocker_text text,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz DEFAULT now();

-- Unique constraint (idempotent)
DO $$ BEGIN
  ALTER TABLE public.checkins ADD CONSTRAINT checkins_weekly_unique UNIQUE (key_result_id, person_id, week_number, year);
EXCEPTION WHEN duplicate_table THEN null; WHEN others THEN null;
END $$;

-- Updated trigger
CREATE OR REPLACE FUNCTION sync_kr_on_checkin()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.key_results
  SET current_value = COALESCE(NEW.new_value, NEW.value_at_checkin, current_value),
      confidence    = COALESCE(NEW.confidence, confidence),
      updated_at    = now()
  WHERE id = NEW.key_result_id;
  IF NEW.week_number IS NOT NULL AND NEW.year IS NOT NULL AND NEW.confidence IS NOT NULL THEN
    INSERT INTO public.confidence_logs (key_result_id, week, year, value, created_by)
    VALUES (NEW.key_result_id, NEW.week_number, NEW.year, NEW.confidence, COALESCE(NEW.person_id, NEW.author_id))
    ON CONFLICT (key_result_id, week, year) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS checkin_syncs_kr_value ON public.checkins;
CREATE TRIGGER checkin_syncs_kr_value
  AFTER INSERT OR UPDATE ON public.checkins
  FOR EACH ROW EXECUTE FUNCTION sync_kr_on_checkin();

-- checkin_streaks table
CREATE TABLE IF NOT EXISTS public.checkin_streaks (
  person_id          uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  current_streak     int NOT NULL DEFAULT 0,
  longest_streak     int NOT NULL DEFAULT 0,
  last_checkin_week  int,
  last_checkin_year  int,
  updated_at         timestamptz DEFAULT now()
);
ALTER TABLE public.checkin_streaks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "streaks_read_all" ON public.checkin_streaks FOR SELECT TO authenticated USING (true); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE POLICY "streaks_write_own" ON public.checkin_streaks FOR ALL TO authenticated USING (person_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title      text NOT NULL,
  body       text,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_person_unread_idx ON public.notifications(person_id, read) WHERE NOT read;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "notif_read_own"   ON public.notifications FOR SELECT TO authenticated USING (person_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE POLICY "notif_update_own" ON public.notifications FOR UPDATE TO authenticated USING (person_id = auth.uid()); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE POLICY "notif_insert_any" ON public.notifications FOR INSERT TO authenticated WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Streak update RPC
CREATE OR REPLACE FUNCTION public.update_checkin_streak(p_person_id uuid, p_week int, p_year int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE last_week int; last_year int; curr int; longest int; prev_week int; prev_year int;
BEGIN
  SELECT last_checkin_week, last_checkin_year, current_streak, longest_streak
  INTO last_week, last_year, curr, longest
  FROM public.checkin_streaks WHERE person_id = p_person_id;
  IF NOT FOUND THEN
    INSERT INTO public.checkin_streaks VALUES (p_person_id, 1, 1, p_week, p_year, now()); RETURN;
  END IF;
  IF last_week = p_week AND last_year = p_year THEN RETURN; END IF;
  prev_week := CASE WHEN p_week = 1 THEN 52 ELSE p_week - 1 END;
  prev_year := CASE WHEN p_week = 1 THEN p_year - 1 ELSE p_year END;
  curr := CASE WHEN last_week = prev_week AND last_year = prev_year THEN curr + 1 ELSE 1 END;
  longest := GREATEST(longest, curr);
  UPDATE public.checkin_streaks
  SET current_streak = curr, longest_streak = longest, last_checkin_week = p_week, last_checkin_year = p_year, updated_at = now()
  WHERE person_id = p_person_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.update_checkin_streak(uuid, int, int) TO authenticated;

SELECT pg_notify('pgrst', 'reload schema');

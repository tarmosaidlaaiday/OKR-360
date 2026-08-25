-- BEFORE UPDATE trigger on one_on_one_entries that enforces field-level
-- authorship based on the caller's actual role in the session.
--
-- Employee-authored fields (report can write, manager cannot):
--   personal_highlight, professional_highlight, personal_low, professional_low,
--   work_wins, work_blockers, work_needs_manager, work_topics,
--   happiness, happiness_followup, feedback_from_report
-- Manager-authored fields (manager can write, report cannot):
--   feedback_for_report
--
-- Note: work_topics is classified as employee-authored here (it lives in the
-- report's prep workflow). A case could be made for it being a shared field;
-- if that changes, remove it from the employee block below.
--
-- Administrative fields (last_saved_at, submitted_at, employee_submitted_at,
-- manager_submitted_at) are not restricted — either participant can touch them.
--
-- NULL caller (service-role / migration context) is allowed through so
-- server-side operations are never accidentally blocked.

CREATE OR REPLACE FUNCTION public.enforce_oo_entry_authorship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_manager_id uuid;
  v_report_id  uuid;
  v_uid        uuid := auth.uid();
BEGIN
  -- Service role or migration context — allow through
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  SELECT manager_id, report_id
    INTO v_manager_id, v_report_id
    FROM public.one_on_ones
   WHERE id = NEW.one_on_one_id;

  -- Session not found — let the existing RLS policy handle access denial
  IF v_manager_id IS NULL THEN RETURN NEW; END IF;

  IF v_uid = v_manager_id THEN
    -- Manager cannot modify employee-authored fields
    IF NEW.personal_highlight     IS DISTINCT FROM OLD.personal_highlight     OR
       NEW.professional_highlight IS DISTINCT FROM OLD.professional_highlight OR
       NEW.personal_low           IS DISTINCT FROM OLD.personal_low           OR
       NEW.professional_low       IS DISTINCT FROM OLD.professional_low       OR
       NEW.work_wins              IS DISTINCT FROM OLD.work_wins              OR
       NEW.work_blockers          IS DISTINCT FROM OLD.work_blockers          OR
       NEW.work_needs_manager     IS DISTINCT FROM OLD.work_needs_manager     OR
       NEW.work_topics            IS DISTINCT FROM OLD.work_topics            OR
       NEW.happiness              IS DISTINCT FROM OLD.happiness              OR
       NEW.happiness_followup     IS DISTINCT FROM OLD.happiness_followup     OR
       NEW.feedback_from_report   IS DISTINCT FROM OLD.feedback_from_report
    THEN
      RAISE EXCEPTION 'Manager cannot modify employee-authored fields in a 1:1 entry';
    END IF;

  ELSIF v_uid = v_report_id THEN
    -- Employee cannot modify manager-authored fields
    IF NEW.feedback_for_report IS DISTINCT FROM OLD.feedback_for_report THEN
      RAISE EXCEPTION 'Employee cannot modify manager-authored fields in a 1:1 entry';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_oo_entry_authorship_trigger ON public.one_on_one_entries;
CREATE TRIGGER enforce_oo_entry_authorship_trigger
  BEFORE UPDATE ON public.one_on_one_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_oo_entry_authorship();

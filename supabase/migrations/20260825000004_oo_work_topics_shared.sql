-- Remove work_topics from the manager-restricted employee fields list.
-- Confirmed: topics should be raisable by either party (agenda items
-- from either side), so the field is now shared / unrestricted.

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
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  SELECT manager_id, report_id
    INTO v_manager_id, v_report_id
    FROM public.one_on_ones
   WHERE id = NEW.one_on_one_id;

  IF v_manager_id IS NULL THEN RETURN NEW; END IF;

  IF v_uid = v_manager_id THEN
    -- Manager cannot modify employee-authored fields.
    -- work_topics is intentionally absent: shared field, either party may add items.
    IF NEW.personal_highlight     IS DISTINCT FROM OLD.personal_highlight     OR
       NEW.professional_highlight IS DISTINCT FROM OLD.professional_highlight OR
       NEW.personal_low           IS DISTINCT FROM OLD.personal_low           OR
       NEW.professional_low       IS DISTINCT FROM OLD.professional_low       OR
       NEW.work_wins              IS DISTINCT FROM OLD.work_wins              OR
       NEW.work_blockers          IS DISTINCT FROM OLD.work_blockers          OR
       NEW.work_needs_manager     IS DISTINCT FROM OLD.work_needs_manager     OR
       NEW.happiness              IS DISTINCT FROM OLD.happiness              OR
       NEW.happiness_followup     IS DISTINCT FROM OLD.happiness_followup     OR
       NEW.feedback_from_report   IS DISTINCT FROM OLD.feedback_from_report
    THEN
      RAISE EXCEPTION 'Manager cannot modify employee-authored fields in a 1:1 entry';
    END IF;

  ELSIF v_uid = v_report_id THEN
    IF NEW.feedback_for_report IS DISTINCT FROM OLD.feedback_for_report THEN
      RAISE EXCEPTION 'Employee cannot modify manager-authored fields in a 1:1 entry';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

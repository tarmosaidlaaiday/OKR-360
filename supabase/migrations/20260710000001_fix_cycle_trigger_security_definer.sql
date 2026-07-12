-- Fix: trigger_generate_default_cycles must run as SECURITY DEFINER so it can
-- insert into cycles without hitting the org-scoped RLS policy.
-- When a brand-new user creates their organisation the trigger fires before
-- their profile.org_id is updated, so the caller's my_org_id() returns NULL
-- and the cycles INSERT fails the RLS check.

CREATE OR REPLACE FUNCTION public.trigger_generate_default_cycles()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.generate_default_cycles(NEW.id);
  RETURN NEW;
END;
$$;

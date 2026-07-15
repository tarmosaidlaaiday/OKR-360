-- Fix send_notification: validate p_person_id belongs to the caller's own org.
-- Previously any authenticated user could inject notifications into any other
-- user's feed in any org (cross-tenant write via SECURITY DEFINER function).

CREATE OR REPLACE FUNCTION public.send_notification(
  p_person_id  uuid,
  p_type       text,
  p_title      text,
  p_body       text    DEFAULT NULL,
  p_action_url text    DEFAULT NULL,
  p_metadata   jsonb   DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_enabled     boolean;
  v_caller_org  uuid;
  v_target_org  uuid;
BEGIN
  SELECT org_id INTO v_caller_org FROM public.profiles WHERE id = auth.uid();
  SELECT org_id INTO v_target_org FROM public.profiles WHERE id = p_person_id;

  -- Silently drop cross-org or anonymous notification attempts
  IF v_caller_org IS NULL OR v_target_org IS NULL OR v_caller_org != v_target_org THEN
    RETURN;
  END IF;

  -- Check preferences: skip if user has opted out
  SELECT in_app_enabled INTO v_enabled
  FROM public.notification_preferences
  WHERE person_id = p_person_id AND type = p_type;

  IF NOT FOUND OR v_enabled THEN
    INSERT INTO public.notifications (person_id, type, title, body, action_url, metadata)
    VALUES (p_person_id, p_type, p_title, p_body, p_action_url, p_metadata);
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.send_notification(uuid, text, text, text, text, jsonb) TO authenticated;

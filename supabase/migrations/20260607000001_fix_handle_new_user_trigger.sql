-- Fix handle_new_user() so newly registered users always get:
--   • email populated from auth.users
--   • status = 'active'
--   • org_id = NULL (null is intentional — onboarding sets it)
-- The ON CONFLICT (id) DO NOTHING makes the trigger idempotent
-- in case it fires more than once (e.g. during social auth flows).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    status,
    org_id
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    'active',
    NULL   -- intentionally null; set by onboarding wizard
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

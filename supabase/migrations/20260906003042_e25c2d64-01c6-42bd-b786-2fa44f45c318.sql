-- Phase 3 follow-up: trigger functions are fired by the system, never called
-- directly, so no API role needs EXECUTE on them.
REVOKE ALL ON FUNCTION public.link_participant_profile_on_signup() FROM authenticated;
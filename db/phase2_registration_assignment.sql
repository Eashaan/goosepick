-- Goosepick Accounts & Registrations — Phase 2 assignment helper
-- STATUS: REVIEW ONLY. DO NOT APPLY AUTOMATICALLY.
--
-- Purpose:
--   Atomically turn one paid experience registration into the existing roster
--   engine's normal public.players row. This does not create a second roster
--   model and does not modify rotation/scoring/reset/session lifecycle logic.

CREATE OR REPLACE FUNCTION public.assign_registration_to_roster(
  p_registration_id uuid,
  p_roster_name text,
  p_court_id bigint DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registration public.experience_registrations%ROWTYPE;
  v_session_status public.session_status;
  v_target_session_id uuid;
  v_player_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF (p_court_id IS NULL) = (p_group_id IS NULL) THEN
    RAISE EXCEPTION 'Choose exactly one roster target: court or group';
  END IF;

  IF NULLIF(btrim(p_roster_name), '') IS NULL THEN
    RAISE EXCEPTION 'Roster name is required';
  END IF;

  SELECT *
    INTO v_registration
    FROM public.experience_registrations
   WHERE id = p_registration_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found';
  END IF;

  IF v_registration.status NOT IN ('paid', 'profile_required', 'confirmed') THEN
    RAISE EXCEPTION 'Registration is not assignable (status: %)', v_registration.status;
  END IF;

  IF v_registration.session_id IS NULL THEN
    RAISE EXCEPTION 'Registration is not mapped to a session';
  END IF;

  SELECT status
    INTO v_session_status
    FROM public.sessions
   WHERE id = v_registration.session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration session not found';
  END IF;

  IF v_session_status = 'ended' THEN
    RAISE EXCEPTION 'Ended sessions cannot be changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.players WHERE registration_id = p_registration_id
  ) THEN
    RAISE EXCEPTION 'Registration is already assigned to a roster player';
  END IF;

  IF p_court_id IS NOT NULL THEN
    SELECT session_id
      INTO v_target_session_id
      FROM public.courts
     WHERE id = p_court_id;
  ELSE
    SELECT session_id
      INTO v_target_session_id
      FROM public.court_groups
     WHERE id = p_group_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Roster target not found';
  END IF;

  IF v_target_session_id IS DISTINCT FROM v_registration.session_id THEN
    RAISE EXCEPTION 'Roster target belongs to a different session';
  END IF;

  INSERT INTO public.players (
    name,
    court_id,
    group_id,
    session_id,
    profile_id,
    registration_id,
    added_by_admin
  ) VALUES (
    btrim(p_roster_name),
    p_court_id,
    p_group_id,
    v_registration.session_id,
    v_registration.profile_id,
    v_registration.id,
    true
  )
  RETURNING id INTO v_player_id;

  RETURN v_player_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'Registration is already assigned to a roster player';
END;
$$;

-- SECURITY DEFINER functions must not retain default/public execution.
REVOKE ALL ON FUNCTION public.assign_registration_to_roster(uuid, text, bigint, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_registration_to_roster(uuid, text, bigint, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_registration_to_roster(uuid, text, bigint, uuid) TO authenticated, service_role;

-- If a guest registration is claimed after an admin has already placed that
-- seat into a roster, keep the roster player's permanent profile linkage in
-- sync. The registration remains the source of truth for this relationship.
CREATE OR REPLACE FUNCTION public.sync_registration_player_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    UPDATE public.players
       SET profile_id = NEW.profile_id
     WHERE registration_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS experience_registrations_sync_player_profile
  ON public.experience_registrations;
CREATE TRIGGER experience_registrations_sync_player_profile
  AFTER UPDATE OF profile_id ON public.experience_registrations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_registration_player_profile();

REVOKE ALL ON FUNCTION public.sync_registration_player_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_registration_player_profile() FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_registration_player_profile() TO service_role;

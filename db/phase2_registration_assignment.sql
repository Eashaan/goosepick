-- Goosepick Accounts & Registrations — Phase 2 (additive only)
-- STATUS: FOR REVIEW ONLY. Not applied to the database in this turn.
-- Apply later via the platform migration tool, byte-for-byte, once approved.
--
-- Phase 1 (db/phase1_participant_accounts.sql) is already live. This file adds:
--   1. assign_registration_to_roster(...) — an admin-only, atomic RPC that turns
--      a paid seat into a normal public.players row (same roster engine) with
--      profile_id + registration_id set. It validates status, session, court /
--      group ownership and returns idempotently when the seat already has a
--      player. Clients never gain write access to experience_registrations.
--   2. A trigger that keeps players.profile_id in step when a registration is
--      claimed / linked to a profile later (guest seat claimed after the admin
--      already added the player).
--
-- The app already prefers the RPC and falls back to the guarded direct insert
-- (admin-only RLS + players_registration_id_key unique index) until it exists,
-- so applying this file is a hardening step, not a prerequisite.

-- ---------------------------------------------------------------------------
-- 1. Atomic registration → roster assignment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_registration_to_roster(
  p_registration_id uuid,
  p_session_id uuid,
  p_court_id integer DEFAULT NULL,
  p_group_id uuid DEFAULT NULL,
  p_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg public.experience_registrations%ROWTYPE;
  v_session_status public.session_status;
  v_existing public.players%ROWTYPE;
  v_name text;
  v_player_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;

  IF p_registration_id IS NULL OR p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Registration and session are required');
  END IF;

  IF (p_court_id IS NULL) = (p_group_id IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Exactly one of court or group is required');
  END IF;

  SELECT status INTO v_session_status FROM public.sessions WHERE id = p_session_id;
  IF v_session_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session not found');
  END IF;
  IF v_session_status = 'ended' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ended sessions are archived and cannot be modified.');
  END IF;

  -- Lock the seat so two admins cannot race past the status checks.
  SELECT * INTO v_reg
  FROM public.experience_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Registration not found');
  END IF;

  IF v_reg.session_id IS DISTINCT FROM p_session_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Registration belongs to a different session');
  END IF;

  IF v_reg.status NOT IN ('paid', 'profile_required', 'confirmed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Registration is ' || v_reg.status || ' and cannot be added to a roster');
  END IF;

  -- Idempotent: the seat already has a player.
  SELECT * INTO v_existing FROM public.players WHERE registration_id = p_registration_id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', 'already_assigned',
      'player_id', v_existing.id,
      'court_id', v_existing.court_id,
      'group_id', v_existing.group_id
    );
  END IF;

  -- The target must belong to the same session.
  IF p_court_id IS NOT NULL THEN
    PERFORM 1 FROM public.courts WHERE id = p_court_id AND session_id = p_session_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Court does not belong to this session');
    END IF;
  ELSE
    PERFORM 1 FROM public.court_groups WHERE id = p_group_id AND session_id = p_session_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Group does not belong to this session');
    END IF;
  END IF;

  -- Roster name precedence: explicit admin name → participant profile →
  -- participant_name captured at checkout → purchaser profile.
  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');

  IF v_name IS NULL AND v_reg.profile_id IS NOT NULL THEN
    SELECT NULLIF(btrim(concat_ws(' ', first_name, last_name)), '')
    INTO v_name
    FROM public.participant_profiles
    WHERE id = v_reg.profile_id;
  END IF;

  IF v_name IS NULL THEN
    v_name := NULLIF(btrim(COALESCE(v_reg.participant_name, '')), '');
  END IF;

  IF v_name IS NULL AND v_reg.purchaser_profile_id IS NOT NULL THEN
    SELECT NULLIF(btrim(concat_ws(' ', first_name, last_name)), '')
    INTO v_name
    FROM public.participant_profiles
    WHERE id = v_reg.purchaser_profile_id;
  END IF;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A roster name is required for this registration');
  END IF;

  BEGIN
    INSERT INTO public.players (
      session_id, court_id, group_id, name, is_guest, added_by_admin, profile_id, registration_id
    )
    VALUES (
      p_session_id, p_court_id, p_group_id, v_name, false, true, v_reg.profile_id, p_registration_id
    )
    RETURNING id INTO v_player_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- Either the seat was assigned concurrently (registration unique index)
      -- or the roster already has this name (session/court|group name index).
      SELECT * INTO v_existing FROM public.players WHERE registration_id = p_registration_id LIMIT 1;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'ok', true,
          'status', 'already_assigned',
          'player_id', v_existing.id,
          'court_id', v_existing.court_id,
          'group_id', v_existing.group_id
        );
      END IF;
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'A player named ' || v_name || ' already exists on this roster. Enter a different roster name.',
        'code', 'duplicate_name'
      );
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'assigned',
    'player_id', v_player_id,
    'name', v_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.assign_registration_to_roster(uuid, uuid, integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_registration_to_roster(uuid, uuid, integer, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.assign_registration_to_roster(uuid, uuid, integer, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Keep players.profile_id consistent when a registration is linked later
--    (e.g. a guest seat is claimed after the admin already added the player).
--    Ended sessions are frozen by design, so archived players are left as-is;
--    the participant page resolves them through registration_id regardless.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_registration_profile_to_player()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.profile_id IS NOT NULL AND NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
    UPDATE public.players p
    SET profile_id = NEW.profile_id
    FROM public.sessions s
    WHERE p.registration_id = NEW.id
      AND p.profile_id IS DISTINCT FROM NEW.profile_id
      AND s.id = p.session_id
      AND s.status <> 'ended';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_registration_profile_to_player() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_registration_profile_to_player() FROM anon;

DROP TRIGGER IF EXISTS experience_registrations_sync_player_profile ON public.experience_registrations;
CREATE TRIGGER experience_registrations_sync_player_profile
  AFTER UPDATE OF profile_id ON public.experience_registrations
  FOR EACH ROW EXECUTE FUNCTION public.sync_registration_profile_to_player();

-- Foundation hardening 3C
-- Standalone scoring RPCs are SECURITY DEFINER, so authorization must be enforced
-- inside the function and anon execution must be revoked.

CREATE OR REPLACE FUNCTION public.start_match_atomic(
  p_session_id uuid,
  p_court_id integer,
  p_match_id uuid,
  p_match_index integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_phase text;
  v_match_status text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;

  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session is required.');
  END IF;

  INSERT INTO court_state(session_id, court_id, current_match_index, phase, updated_at)
  VALUES (p_session_id, p_court_id, 0, 'idle', now())
  ON CONFLICT (session_id, court_id) DO NOTHING;

  SELECT phase::text INTO v_current_phase
  FROM court_state
  WHERE session_id = p_session_id AND court_id = p_court_id
  FOR UPDATE;

  SELECT status::text INTO v_match_status
  FROM matches
  WHERE id = p_match_id
    AND session_id = p_session_id
    AND court_id = p_court_id;

  IF v_match_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Match does not belong to this session and court.');
  END IF;

  IF v_current_phase = 'in_progress' THEN
    IF v_match_status = 'in_progress' THEN
      RETURN jsonb_build_object('ok', true, 'status', 'already_started');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'Another match is currently active on this court.');
  END IF;

  IF v_match_status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Match is not pending.');
  END IF;

  UPDATE matches
  SET status = 'in_progress', started_at = COALESCE(started_at, now())
  WHERE id = p_match_id
    AND session_id = p_session_id
    AND court_id = p_court_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Match could not be started.');
  END IF;

  UPDATE court_state
  SET phase = 'in_progress',
      current_match_index = p_match_index,
      updated_at = now()
  WHERE session_id = p_session_id AND court_id = p_court_id;

  RETURN jsonb_build_object('ok', true, 'status', 'started');
END;
$$;

CREATE OR REPLACE FUNCTION public.end_match_atomic(
  p_session_id uuid,
  p_court_id integer,
  p_match_id uuid,
  p_team1_score integer,
  p_team2_score integer,
  p_is_override boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_phase text;
  v_match_status text;
  v_next_match record;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;

  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session is required.');
  END IF;
  IF p_team1_score IS NULL OR p_team2_score IS NULL OR p_team1_score < 0 OR p_team2_score < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Scores must be non-negative numbers.');
  END IF;

  SELECT phase::text INTO v_current_phase
  FROM court_state
  WHERE session_id = p_session_id AND court_id = p_court_id
  FOR UPDATE;

  IF v_current_phase IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Court state not found for this session.');
  END IF;

  SELECT status::text INTO v_match_status
  FROM matches
  WHERE id = p_match_id
    AND session_id = p_session_id
    AND court_id = p_court_id;

  IF v_match_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Match does not belong to this session and court.');
  END IF;

  IF v_match_status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_completed');
  END IF;

  IF v_current_phase <> 'in_progress' OR v_match_status <> 'in_progress' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This match is not the active match for this session.');
  END IF;

  UPDATE matches
  SET team1_score = p_team1_score,
      team2_score = p_team2_score,
      status = 'completed',
      completed_at = now(),
      override_played = p_is_override
  WHERE id = p_match_id
    AND session_id = p_session_id
    AND court_id = p_court_id
    AND status = 'in_progress';

  SELECT id, match_index INTO v_next_match
  FROM matches
  WHERE session_id = p_session_id
    AND court_id = p_court_id
    AND status <> 'completed'
    AND id <> p_match_id
  ORDER BY match_index ASC
  LIMIT 1;

  IF v_next_match IS NULL THEN
    UPDATE court_state
    SET phase = 'completed', updated_at = now()
    WHERE session_id = p_session_id AND court_id = p_court_id;
    RETURN jsonb_build_object('ok', true, 'status', 'completed_all');
  END IF;

  UPDATE court_state
  SET phase = 'idle',
      current_match_index = v_next_match.match_index,
      updated_at = now()
  WHERE session_id = p_session_id AND court_id = p_court_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'ended',
    'next_match_index', v_next_match.match_index
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_match_atomic(uuid, integer, uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.end_match_atomic(uuid, integer, uuid, integer, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_match_atomic(uuid, integer, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_match_atomic(uuid, integer, uuid, integer, integer, boolean) TO authenticated;

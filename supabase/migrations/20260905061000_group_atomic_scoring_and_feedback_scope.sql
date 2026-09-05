-- Foundation hardening 3A
-- 1) Make group scoring server-atomic and admin-only.
-- 2) Bind feedback to group identity when submitted from a group.

ALTER TABLE public.feedback
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.court_groups(id);

CREATE INDEX IF NOT EXISTS feedback_session_group_idx
  ON public.feedback(session_id, group_id)
  WHERE group_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.start_group_match_atomic(
  p_session_id uuid,
  p_group_id uuid,
  p_court_number integer,
  p_match_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state public.group_court_state%ROWTYPE;
  v_match public.matches%ROWTYPE;
  v_conflict text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;

  IF p_session_id IS NULL OR p_group_id IS NULL OR p_match_id IS NULL OR p_court_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session, group, court, and match are required');
  END IF;

  -- Serialize *all* starts within this group, not merely starts on one physical
  -- court. Without this group-row lock two admins could concurrently start two
  -- matches on different courts that share a player before either transaction
  -- becomes visible to the other.
  PERFORM id
  FROM public.court_groups
  WHERE id = p_group_id
    AND session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Group does not belong to this session');
  END IF;

  SELECT * INTO v_state
  FROM public.group_court_state
  WHERE session_id = p_session_id
    AND group_id = p_group_id
    AND court_number = p_court_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Group court state not found for this session');
  END IF;

  IF v_state.is_live THEN
    IF v_state.current_match_id = p_match_id THEN
      RETURN jsonb_build_object('ok', true, 'status', 'already_started');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'This court already has a live match');
  END IF;

  SELECT * INTO v_match
  FROM public.matches
  WHERE id = p_match_id
    AND session_id = p_session_id
    AND group_id = p_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Match does not belong to this session and group');
  END IF;

  IF v_match.status = 'in_progress' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_started');
  END IF;

  IF v_match.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Match is not pending');
  END IF;

  -- Re-check player concurrency inside the serialized DB transaction.
  SELECT p.name INTO v_conflict
  FROM public.matches lm
  JOIN public.players p ON p.id IN (
    v_match.team1_player1_id,
    v_match.team1_player2_id,
    v_match.team2_player1_id,
    v_match.team2_player2_id
  )
  WHERE lm.session_id = p_session_id
    AND lm.group_id = p_group_id
    AND lm.status = 'in_progress'
    AND lm.id <> p_match_id
    AND (
      lm.team1_player1_id = p.id OR
      lm.team1_player2_id = p.id OR
      lm.team2_player1_id = p.id OR
      lm.team2_player2_id = p.id
    )
  LIMIT 1;

  IF v_conflict IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', v_conflict || ' is currently playing on another court');
  END IF;

  UPDATE public.matches
  SET status = 'in_progress',
      started_at = COALESCE(started_at, now()),
      court_number = p_court_number
  WHERE id = p_match_id
    AND session_id = p_session_id
    AND group_id = p_group_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Match could not be started');
  END IF;

  UPDATE public.group_court_state
  SET current_match_id = p_match_id,
      current_match_global_index = v_match.global_match_index,
      is_live = true,
      updated_at = now()
  WHERE session_id = p_session_id
    AND group_id = p_group_id
    AND court_number = p_court_number;

  RETURN jsonb_build_object('ok', true, 'status', 'started');
END;
$$;

CREATE OR REPLACE FUNCTION public.end_group_match_atomic(
  p_session_id uuid,
  p_group_id uuid,
  p_court_number integer,
  p_match_id uuid,
  p_team1_score integer,
  p_team2_score integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state public.group_court_state%ROWTYPE;
  v_status text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;

  IF p_session_id IS NULL OR p_group_id IS NULL OR p_match_id IS NULL OR p_court_number IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session, group, court, and match are required');
  END IF;
  IF p_team1_score IS NULL OR p_team2_score IS NULL OR p_team1_score < 0 OR p_team2_score < 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Scores must be non-negative numbers');
  END IF;

  PERFORM id
  FROM public.court_groups
  WHERE id = p_group_id
    AND session_id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Group does not belong to this session');
  END IF;

  SELECT * INTO v_state
  FROM public.group_court_state
  WHERE session_id = p_session_id
    AND group_id = p_group_id
    AND court_number = p_court_number
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Group court state not found for this session');
  END IF;

  SELECT status INTO v_status
  FROM public.matches
  WHERE id = p_match_id
    AND session_id = p_session_id
    AND group_id = p_group_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Match does not belong to this session and group');
  END IF;

  IF v_status = 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_completed');
  END IF;

  IF NOT v_state.is_live OR v_state.current_match_id IS DISTINCT FROM p_match_id OR v_status <> 'in_progress' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'This match is not the live match on this court');
  END IF;

  UPDATE public.matches
  SET status = 'completed',
      team1_score = p_team1_score,
      team2_score = p_team2_score,
      completed_at = now()
  WHERE id = p_match_id
    AND session_id = p_session_id
    AND group_id = p_group_id
    AND status = 'in_progress';

  UPDATE public.group_court_state
  SET current_match_id = null,
      current_match_global_index = null,
      is_live = false,
      updated_at = now()
  WHERE session_id = p_session_id
    AND group_id = p_group_id
    AND court_number = p_court_number;

  RETURN jsonb_build_object('ok', true, 'status', 'completed');
END;
$$;

-- SECURITY DEFINER scoring functions must never be directly callable by anon.
REVOKE ALL ON FUNCTION public.start_group_match_atomic(uuid, uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.end_group_match_atomic(uuid, uuid, integer, uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_group_match_atomic(uuid, uuid, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_group_match_atomic(uuid, uuid, integer, uuid, integer, integer) TO authenticated;

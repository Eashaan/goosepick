
-- 1. Sessions table for date-based isolation
CREATE TABLE public.sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  city_id uuid NOT NULL REFERENCES public.cities(id),
  event_type public.scope_event_type NOT NULL,
  location_id uuid REFERENCES public.locations(id),
  date date NOT NULL DEFAULT CURRENT_DATE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(city_id, event_type, location_id, date)
);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view sessions" ON public.sessions FOR SELECT USING (true);
CREATE POLICY "Admins can insert sessions" ON public.sessions FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update sessions" ON public.sessions FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete sessions" ON public.sessions FOR DELETE USING (is_admin());

-- 2. Add session_id to courts table
ALTER TABLE public.courts ADD COLUMN session_id uuid REFERENCES public.sessions(id);

-- 3. Rotation audit table
CREATE TABLE public.rotation_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid REFERENCES public.sessions(id),
  court_id integer NOT NULL REFERENCES public.courts(id),
  total_players integer NOT NULL,
  matches_per_player_min integer NOT NULL,
  matches_per_player_max integer NOT NULL,
  max_consecutive_sitouts integer NOT NULL,
  repeat_partner_count integer NOT NULL DEFAULT 0,
  repeat_opponent_count integer NOT NULL DEFAULT 0,
  fairness_score numeric NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rotation_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view rotation_audit" ON public.rotation_audit FOR SELECT USING (true);
CREATE POLICY "Admins can insert rotation_audit" ON public.rotation_audit FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can delete rotation_audit" ON public.rotation_audit FOR DELETE USING (is_admin());

-- 4. Atomic start_match RPC
CREATE OR REPLACE FUNCTION public.start_match_atomic(
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
  v_rows_updated integer;
BEGIN
  -- Check current court state
  SELECT phase INTO v_current_phase
  FROM court_state
  WHERE court_id = p_court_id
  FOR UPDATE;

  -- If already in_progress, check if it's the same match
  IF v_current_phase = 'in_progress' THEN
    -- Check if this exact match is already in progress
    IF EXISTS (
      SELECT 1 FROM matches
      WHERE id = p_match_id AND court_id = p_court_id AND status = 'in_progress'
    ) THEN
      RETURN jsonb_build_object('ok', true, 'status', 'already_started');
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'Another match is currently active.');
    END IF;
  END IF;

  -- Atomically update match status
  UPDATE matches
  SET status = 'in_progress', started_at = now()
  WHERE id = p_match_id AND court_id = p_court_id AND status = 'pending'
  RETURNING 1 INTO v_rows_updated;

  IF v_rows_updated IS NULL THEN
    -- Match may already be completed or doesn't exist
    RETURN jsonb_build_object('ok', false, 'error', 'Match not found or already completed.');
  END IF;

  -- Update court state atomically
  UPDATE court_state
  SET phase = 'in_progress',
      current_match_index = p_match_index,
      updated_at = now()
  WHERE court_id = p_court_id;

  RETURN jsonb_build_object('ok', true, 'status', 'started');
END;
$$;

-- 5. Atomic end_match RPC
CREATE OR REPLACE FUNCTION public.end_match_atomic(
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
  v_rows_updated integer;
BEGIN
  -- Validate scores
  IF p_team1_score IS NULL OR p_team2_score IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Scores cannot be null.');
  END IF;

  -- Lock court state row
  SELECT phase INTO v_current_phase
  FROM court_state
  WHERE court_id = p_court_id
  FOR UPDATE;

  -- Check match current status
  SELECT status INTO v_match_status
  FROM matches
  WHERE id = p_match_id AND court_id = p_court_id;

  -- If already completed, return success (idempotent)
  IF v_match_status = 'completed' THEN
    -- Update scores if different (overwrite)
    UPDATE matches
    SET team1_score = p_team1_score,
        team2_score = p_team2_score,
        completed_at = now()
    WHERE id = p_match_id AND court_id = p_court_id;
    RETURN jsonb_build_object('ok', true, 'status', 'already_completed');
  END IF;

  -- Only end if in_progress
  IF v_current_phase != 'in_progress' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Court is not in an active match.');
  END IF;

  -- Complete the match
  UPDATE matches
  SET team1_score = p_team1_score,
      team2_score = p_team2_score,
      status = 'completed',
      completed_at = now(),
      override_played = p_is_override
  WHERE id = p_match_id AND court_id = p_court_id;

  -- Find next uncompleted match
  SELECT id, match_index INTO v_next_match
  FROM matches
  WHERE court_id = p_court_id
    AND status != 'completed'
    AND id != p_match_id
  ORDER BY match_index ASC
  LIMIT 1;

  IF v_next_match IS NULL THEN
    -- All matches completed
    UPDATE court_state
    SET phase = 'completed', updated_at = now()
    WHERE court_id = p_court_id;
    RETURN jsonb_build_object('ok', true, 'status', 'completed_all');
  ELSE
    -- Move to idle, advance index
    UPDATE court_state
    SET phase = 'idle',
        current_match_index = v_next_match.match_index,
        updated_at = now()
    WHERE court_id = p_court_id;
    RETURN jsonb_build_object('ok', true, 'status', 'ended', 'next_match_index', v_next_match.match_index);
  END IF;
END;
$$;

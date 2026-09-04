-- Foundation repair 2: make operational court configuration/state truly session scoped.
-- This migration preserves legacy rows while making all new/current rows unambiguous by session_id.

-- -----------------------------------------------------------------------------
-- 1. session_configs: allow one config per session instead of one config forever
--    per city/event/location scope.
-- -----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.idx_session_configs_context;
DROP INDEX IF EXISTS public.session_configs_scope_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS session_configs_session_unique_idx
  ON public.session_configs(session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS session_configs_scope_session_idx
  ON public.session_configs(city_id, event_type, location_id, session_id);

-- -----------------------------------------------------------------------------
-- 2. court_units: bind each rendered court/group unit to exactly one session.
-- -----------------------------------------------------------------------------
ALTER TABLE public.court_units
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.sessions(id);

-- Backfill group units from their linked court_group first.
UPDATE public.court_units cu
SET session_id = cg.session_id
FROM public.court_groups cg
WHERE cu.session_id IS NULL
  AND cu.court_group_id = cg.id
  AND cg.session_id IS NOT NULL;

-- Backfill remaining units from the current config for the same scope.
UPDATE public.court_units cu
SET session_id = sc.session_id
FROM public.session_configs sc
WHERE cu.session_id IS NULL
  AND sc.session_id IS NOT NULL
  AND sc.city_id = cu.city_id
  AND sc.event_type = cu.event_type
  AND COALESCE(sc.location_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = COALESCE(cu.location_id, '00000000-0000-0000-0000-000000000000'::uuid);

-- Final compatibility backfill for standalone units from courts.session_id.
UPDATE public.court_units cu
SET session_id = c.session_id
FROM public.courts c
WHERE cu.session_id IS NULL
  AND cu.court_id = c.id
  AND c.session_id IS NOT NULL;

DROP INDEX IF EXISTS public.court_units_court_scope_idx;
DROP INDEX IF EXISTS public.court_units_group_scope_idx;

CREATE UNIQUE INDEX IF NOT EXISTS court_units_court_session_idx
  ON public.court_units(session_id, court_number)
  WHERE type = 'court' AND session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS court_units_group_session_idx
  ON public.court_units(session_id, display_name)
  WHERE type = 'group' AND session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS court_units_session_lookup_idx
  ON public.court_units(session_id, type);

-- -----------------------------------------------------------------------------
-- 3. court_state: old schema had court_id as the PK, so the same court could not
--    have independent state in two sessions. Give state its own PK and enforce
--    one state row per session+court.
-- -----------------------------------------------------------------------------
ALTER TABLE public.court_state
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

UPDATE public.court_state SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE public.court_state ALTER COLUMN id SET NOT NULL;

ALTER TABLE public.court_state DROP CONSTRAINT IF EXISTS court_state_pkey;
ALTER TABLE public.court_state ADD CONSTRAINT court_state_pkey PRIMARY KEY (id);

ALTER TABLE public.court_state DROP CONSTRAINT IF EXISTS court_state_session_court_key;
ALTER TABLE public.court_state
  ADD CONSTRAINT court_state_session_court_key UNIQUE (session_id, court_id);

CREATE INDEX IF NOT EXISTS court_state_session_idx
  ON public.court_state(session_id, court_id);

-- -----------------------------------------------------------------------------
-- 4. Legacy uniqueness constraints must include session_id.
-- -----------------------------------------------------------------------------
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_court_id_match_index_key;
ALTER TABLE public.matches DROP CONSTRAINT IF EXISTS matches_session_court_match_key;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_session_court_match_key UNIQUE (session_id, court_id, match_index);

ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_court_id_name_key;
DROP INDEX IF EXISTS public.players_session_court_name_idx;
DROP INDEX IF EXISTS public.players_session_group_name_idx;
CREATE UNIQUE INDEX players_session_court_name_idx
  ON public.players(session_id, court_id, lower(name))
  WHERE session_id IS NOT NULL AND court_id IS NOT NULL AND group_id IS NULL;
CREATE UNIQUE INDEX players_session_group_name_idx
  ON public.players(session_id, group_id, lower(name))
  WHERE session_id IS NOT NULL AND group_id IS NOT NULL;

ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_court_id_player_id_key;
ALTER TABLE public.feedback DROP CONSTRAINT IF EXISTS feedback_session_court_player_key;
ALTER TABLE public.feedback
  ADD CONSTRAINT feedback_session_court_player_key UNIQUE (session_id, court_id, player_id);

-- -----------------------------------------------------------------------------
-- 5. Session-aware atomic scoring RPCs. Old unsafe signatures are removed so
--    callers cannot accidentally score against another session on the same court.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.start_match_atomic(integer, uuid, integer);
DROP FUNCTION IF EXISTS public.end_match_atomic(integer, uuid, integer, integer, boolean);

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
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session is required.');
  END IF;

  -- Ensure state exists for this exact session+court, then lock it.
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
  IF p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session is required.');
  END IF;
  IF p_team1_score IS NULL OR p_team2_score IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Scores cannot be null.');
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
    UPDATE matches
    SET team1_score = p_team1_score,
        team2_score = p_team2_score
    WHERE id = p_match_id
      AND session_id = p_session_id
      AND court_id = p_court_id;
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

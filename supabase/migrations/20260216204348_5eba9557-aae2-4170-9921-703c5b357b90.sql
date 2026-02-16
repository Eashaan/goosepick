
-- ============================================================
-- Phase 1: Schema changes for Court Group Mystery Partner format
-- ============================================================

-- 1. Extend court_groups with time/match config
ALTER TABLE public.court_groups
  ADD COLUMN IF NOT EXISTS duration_hours numeric DEFAULT 2,
  ADD COLUMN IF NOT EXISTS matches_per_hour integer DEFAULT 6,
  ADD COLUMN IF NOT EXISTS total_matches integer,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;

-- 2. Make players.court_id nullable for group players
ALTER TABLE public.players
  ALTER COLUMN court_id DROP NOT NULL;

-- 3. Add group_id to players
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.court_groups(id);

-- 4. Extend matches for group support
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.court_groups(id),
  ADD COLUMN IF NOT EXISTS court_number integer,
  ADD COLUMN IF NOT EXISTS global_match_index integer;

-- 5. Create group_court_state for parallel scoring
CREATE TABLE IF NOT EXISTS public.group_court_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.sessions(id),
  group_id uuid NOT NULL REFERENCES public.court_groups(id),
  court_number integer NOT NULL,
  current_match_global_index integer,
  current_match_id uuid REFERENCES public.matches(id),
  is_live boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, group_id, court_number)
);

ALTER TABLE public.group_court_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view group_court_state"
  ON public.group_court_state FOR SELECT USING (true);

CREATE POLICY "Admins can insert group_court_state"
  ON public.group_court_state FOR INSERT WITH CHECK (is_admin());

CREATE POLICY "Admins can update group_court_state"
  ON public.group_court_state FOR UPDATE USING (is_admin());

CREATE POLICY "Admins can delete group_court_state"
  ON public.group_court_state FOR DELETE USING (is_admin());

-- 6. Extend match_substitutions for group context
ALTER TABLE public.match_substitutions
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.court_groups(id),
  ADD COLUMN IF NOT EXISTS global_match_index integer,
  ADD COLUMN IF NOT EXISTS slot text,
  ADD COLUMN IF NOT EXISTS reason text;

-- 7. Add realtime for group_court_state
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_court_state;

-- 8. Index for group matches lookup
CREATE INDEX IF NOT EXISTS idx_matches_group_id ON public.matches(group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_group_status ON public.matches(group_id, status) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_players_group_id ON public.players(group_id) WHERE group_id IS NOT NULL;

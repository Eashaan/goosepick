
-- 1. Create session_status enum
CREATE TYPE public.session_status AS ENUM ('draft', 'live', 'ended');

-- 2. Alter sessions table: add status, started_at, ended_at, session_label
ALTER TABLE public.sessions
  ADD COLUMN status public.session_status NOT NULL DEFAULT 'draft',
  ADD COLUMN started_at timestamptz,
  ADD COLUMN ended_at timestamptz,
  ADD COLUMN session_label text;

-- Migrate existing data: is_active=true → live, is_active=false → ended
UPDATE public.sessions SET status = 'live', started_at = created_at WHERE is_active = true;
UPDATE public.sessions SET status = 'ended', ended_at = created_at WHERE is_active = false;

-- 3. Partial unique index: only one LIVE session per scope
CREATE UNIQUE INDEX uq_sessions_live_per_scope
  ON public.sessions (city_id, event_type, location_id)
  WHERE status = 'live';

-- 4. Add session_id to operational tables (nullable for backward compat with existing rows)
ALTER TABLE public.players ADD COLUMN session_id uuid REFERENCES public.sessions(id);
ALTER TABLE public.matches ADD COLUMN session_id uuid REFERENCES public.sessions(id);
ALTER TABLE public.feedback ADD COLUMN session_id uuid REFERENCES public.sessions(id);
ALTER TABLE public.court_state ADD COLUMN session_id uuid REFERENCES public.sessions(id);
ALTER TABLE public.match_substitutions ADD COLUMN session_id uuid REFERENCES public.sessions(id);
ALTER TABLE public.court_groups ADD COLUMN session_id uuid REFERENCES public.sessions(id);

-- 5. Indexes for session_id lookups
CREATE INDEX idx_players_session ON public.players(session_id);
CREATE INDEX idx_matches_session ON public.matches(session_id);
CREATE INDEX idx_feedback_session ON public.feedback(session_id);
CREATE INDEX idx_court_state_session ON public.court_state(session_id);
CREATE INDEX idx_match_substitutions_session ON public.match_substitutions(session_id);

-- 6. Add session_id to session_configs for tighter coupling
ALTER TABLE public.session_configs ADD COLUMN session_id uuid REFERENCES public.sessions(id);

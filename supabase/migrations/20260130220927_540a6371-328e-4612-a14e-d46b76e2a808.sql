-- Create phase enum for court state
CREATE TYPE public.court_phase AS ENUM ('idle', 'in_progress', 'completed');

-- Create feedback rating enum
CREATE TYPE public.feedback_rating AS ENUM ('loved', 'good', 'okay');

-- Courts table (pre-seeded with 7 courts)
CREATE TABLE public.courts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

-- Pre-seed 7 courts
INSERT INTO public.courts (name) VALUES 
  ('Court 1'), ('Court 2'), ('Court 3'), ('Court 4'), 
  ('Court 5'), ('Court 6'), ('Court 7');

-- Players table
CREATE TABLE public.players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id INTEGER NOT NULL REFERENCES public.courts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(court_id, name)
);

-- Matches table
CREATE TABLE public.matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id INTEGER NOT NULL REFERENCES public.courts(id) ON DELETE CASCADE,
  match_index INTEGER NOT NULL,
  team1_player1_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
  team1_player2_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
  team2_player1_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
  team2_player2_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
  team1_score INTEGER,
  team2_score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(court_id, match_index)
);

-- Court state table
CREATE TABLE public.court_state (
  court_id INTEGER PRIMARY KEY REFERENCES public.courts(id) ON DELETE CASCADE,
  current_match_index INTEGER NOT NULL DEFAULT 0,
  phase court_phase NOT NULL DEFAULT 'idle',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Initialize court_state for all courts
INSERT INTO public.court_state (court_id) VALUES (1), (2), (3), (4), (5), (6), (7);

-- Feedback table
CREATE TABLE public.feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  court_id INTEGER NOT NULL REFERENCES public.courts(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  rating feedback_rating NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(court_id, player_id)
);

-- Enable RLS on all tables
ALTER TABLE public.courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.court_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Courts: public read
CREATE POLICY "Anyone can view courts" ON public.courts
  FOR SELECT USING (true);

-- Players: public read, admin insert/update/delete (handled via app)
CREATE POLICY "Anyone can view players" ON public.players
  FOR SELECT USING (true);

CREATE POLICY "Anyone can insert players" ON public.players
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update players" ON public.players
  FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete players" ON public.players
  FOR DELETE USING (true);

-- Matches: public read, admin insert/update/delete
CREATE POLICY "Anyone can view matches" ON public.matches
  FOR SELECT USING (true);

CREATE POLICY "Anyone can insert matches" ON public.matches
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Anyone can update matches" ON public.matches
  FOR UPDATE USING (true);

CREATE POLICY "Anyone can delete matches" ON public.matches
  FOR DELETE USING (true);

-- Court state: public read, admin update
CREATE POLICY "Anyone can view court_state" ON public.court_state
  FOR SELECT USING (true);

CREATE POLICY "Anyone can update court_state" ON public.court_state
  FOR UPDATE USING (true);

-- Feedback: public insert (one per player per court), public read
CREATE POLICY "Anyone can view feedback" ON public.feedback
  FOR SELECT USING (true);

CREATE POLICY "Anyone can insert feedback" ON public.feedback
  FOR INSERT WITH CHECK (true);

-- Enable realtime for court_state and matches
ALTER PUBLICATION supabase_realtime ADD TABLE public.court_state;
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;
ALTER PUBLICATION supabase_realtime ADD TABLE public.players;
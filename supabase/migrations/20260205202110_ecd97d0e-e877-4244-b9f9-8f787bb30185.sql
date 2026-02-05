-- Add guest metadata columns to players table
ALTER TABLE public.players
ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS added_by_admin boolean NOT NULL DEFAULT false;

-- Create match_substitutions audit table
CREATE TABLE public.match_substitutions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  court_id integer NOT NULL REFERENCES public.courts(id),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  replaced_player_id uuid NOT NULL REFERENCES public.players(id),
  substitute_player_id uuid NOT NULL REFERENCES public.players(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.match_substitutions ENABLE ROW LEVEL SECURITY;

-- RLS policies for match_substitutions
CREATE POLICY "Anyone can view match_substitutions"
ON public.match_substitutions
FOR SELECT
USING (true);

CREATE POLICY "Admins can insert match_substitutions"
ON public.match_substitutions
FOR INSERT
WITH CHECK (is_admin());

-- Add index for efficient lookups
CREATE INDEX idx_match_substitutions_match_id ON public.match_substitutions(match_id);
CREATE INDEX idx_match_substitutions_court_id ON public.match_substitutions(court_id);

-- Enable realtime for substitutions
ALTER PUBLICATION supabase_realtime ADD TABLE public.match_substitutions;
DROP POLICY IF EXISTS "Anyone can view players" ON public.players;
CREATE POLICY "Public can view players of visible sessions" ON public.players FOR SELECT
USING (public.is_admin() OR session_id IS NULL OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = players.session_id));

DROP POLICY IF EXISTS "Anyone can view matches" ON public.matches;
CREATE POLICY "Public can view matches of visible sessions" ON public.matches FOR SELECT
USING (public.is_admin() OR session_id IS NULL OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = matches.session_id));
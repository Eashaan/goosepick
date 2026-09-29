-- Part 1: Thursday default capacity 18 + apply to future drafts (mirrors admin_apply_schedule_capacity; manual overrides preserved)
UPDATE public.recurring_experience_schedules SET default_capacity = 18, updated_at = now()
WHERE id IN ('f0cb217e-a257-41d8-94dd-0ae9f5527401','cb3a9c35-6b3e-47ce-973b-9aa0a8ca02cc');

UPDATE public.sessions s SET capacity = 18, capacity_source = 'inherited'
WHERE s.recurring_schedule_id IN ('f0cb217e-a257-41d8-94dd-0ae9f5527401','cb3a9c35-6b3e-47ce-973b-9aa0a8ca02cc')
  AND s.status = 'draft' AND s.is_active = false AND s.date >= current_date
  AND COALESCE(s.capacity_source,'') <> 'manual'
  AND public.session_booked_seats(s.id) <= 18;

-- Part 2: hide future scheduled drafts and their setup/state from the public
DROP POLICY IF EXISTS "Anyone can view sessions" ON public.sessions;
CREATE POLICY "Public can view current and past sessions" ON public.sessions FOR SELECT
USING (public.is_admin() OR status <> 'draft' OR date <= current_date);

DROP POLICY IF EXISTS "Anyone can view session_configs" ON public.session_configs;
CREATE POLICY "Public can view configs of visible sessions" ON public.session_configs FOR SELECT
USING (public.is_admin() OR session_id IS NULL OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_configs.session_id));

DROP POLICY IF EXISTS "Anyone can view court_state" ON public.court_state;
CREATE POLICY "Public can view court_state of visible sessions" ON public.court_state FOR SELECT
USING (public.is_admin() OR session_id IS NULL OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = court_state.session_id));

DROP POLICY IF EXISTS "Anyone can view group_court_state" ON public.group_court_state;
CREATE POLICY "Public can view group_court_state of visible sessions" ON public.group_court_state FOR SELECT
USING (public.is_admin() OR session_id IS NULL OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = group_court_state.session_id));

-- Least-privilege EXECUTE (is_admin stays callable: RLS policies evaluate it for anon)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.prevent_ended_session_mutation() FROM PUBLIC, anon, authenticated;
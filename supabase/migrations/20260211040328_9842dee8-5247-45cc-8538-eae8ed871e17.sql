
-- Session configs: one per city/event/location context
CREATE TABLE public.session_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  city_id UUID NOT NULL REFERENCES public.cities(id),
  event_id UUID NOT NULL REFERENCES public.events(id),
  location_id UUID REFERENCES public.locations(id),
  court_count INTEGER NOT NULL,
  setup_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one config per context (coalesce null location_id)
CREATE UNIQUE INDEX idx_session_configs_context 
  ON public.session_configs (city_id, event_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'));

ALTER TABLE public.session_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view session_configs" ON public.session_configs FOR SELECT USING (true);
CREATE POLICY "Admins can insert session_configs" ON public.session_configs FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update session_configs" ON public.session_configs FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete session_configs" ON public.session_configs FOR DELETE USING (is_admin());

-- Court groups: grouping of courts within a session
CREATE TABLE public.court_groups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_config_id UUID NOT NULL REFERENCES public.session_configs(id) ON DELETE CASCADE,
  court_ids INTEGER[] NOT NULL,
  format_type public.format_type NOT NULL DEFAULT 'mystery_partner',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.court_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view court_groups" ON public.court_groups FOR SELECT USING (true);
CREATE POLICY "Admins can insert court_groups" ON public.court_groups FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update court_groups" ON public.court_groups FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete court_groups" ON public.court_groups FOR DELETE USING (is_admin());

-- Enable realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.session_configs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.court_groups;

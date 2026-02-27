
ALTER TABLE public.court_units
ADD COLUMN court_group_id uuid REFERENCES public.court_groups(id) ON DELETE SET NULL;

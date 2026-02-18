
-- Create group_physical_courts mapping table
-- Maps each physical court_number in a group to a unique courts.id
CREATE TABLE public.group_physical_courts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES court_groups(id),
  court_number integer NOT NULL,
  court_id integer NOT NULL REFERENCES courts(id),
  session_id uuid REFERENCES sessions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, court_number, session_id)
);

ALTER TABLE public.group_physical_courts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view group_physical_courts" ON public.group_physical_courts FOR SELECT USING (true);
CREATE POLICY "Admins can insert group_physical_courts" ON public.group_physical_courts FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update group_physical_courts" ON public.group_physical_courts FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete group_physical_courts" ON public.group_physical_courts FOR DELETE USING (is_admin());


-- 1. Create scope_event_type enum
CREATE TYPE public.scope_event_type AS ENUM ('social', 'thursdays');

-- 2. Add event_type to session_configs
ALTER TABLE public.session_configs ADD COLUMN event_type public.scope_event_type;

-- 3. Backfill event_type from events table
UPDATE public.session_configs sc
SET event_type = CASE 
  WHEN e.event_type = 'one_off' THEN 'social'::public.scope_event_type
  WHEN e.event_type = 'recurring' THEN 'thursdays'::public.scope_event_type
END
FROM public.events e WHERE sc.event_id = e.id;

-- Handle any rows without matching event
UPDATE public.session_configs SET event_type = 'social' WHERE event_type IS NULL;

-- 4. Make NOT NULL
ALTER TABLE public.session_configs ALTER COLUMN event_type SET NOT NULL;

-- 5. Add updated_at if missing
ALTER TABLE public.session_configs ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- 6. Unique index for scope (COALESCE handles NULL location_id)
CREATE UNIQUE INDEX session_configs_scope_unique_idx 
  ON public.session_configs (city_id, event_type, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- 7. Create court_units table
CREATE TABLE public.court_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.cities(id),
  event_type public.scope_event_type NOT NULL,
  location_id uuid REFERENCES public.locations(id),
  type text NOT NULL CHECK (type IN ('court', 'group')),
  court_number int,
  group_court_numbers int[],
  display_name text NOT NULL,
  format_type public.format_type NOT NULL DEFAULT 'mystery_partner',
  is_locked boolean NOT NULL DEFAULT false,
  court_id int REFERENCES public.courts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 8. Partial unique indexes for courts and groups within scope
CREATE UNIQUE INDEX court_units_court_scope_idx 
  ON public.court_units (city_id, event_type, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), court_number) 
  WHERE type = 'court';

CREATE UNIQUE INDEX court_units_group_scope_idx 
  ON public.court_units (city_id, event_type, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), display_name) 
  WHERE type = 'group';

-- 9. Enable RLS
ALTER TABLE public.court_units ENABLE ROW LEVEL SECURITY;

-- 10. RLS policies
CREATE POLICY "Anyone can view court_units" ON public.court_units FOR SELECT USING (true);
CREATE POLICY "Admins can insert court_units" ON public.court_units FOR INSERT WITH CHECK (is_admin());
CREATE POLICY "Admins can update court_units" ON public.court_units FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can delete court_units" ON public.court_units FOR DELETE USING (is_admin());

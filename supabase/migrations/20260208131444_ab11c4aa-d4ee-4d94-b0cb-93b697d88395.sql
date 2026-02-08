
-- Create cities table
CREATE TABLE public.cities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

-- Anyone can view cities
CREATE POLICY "Anyone can view cities"
  ON public.cities FOR SELECT
  USING (true);

-- Seed Mumbai
INSERT INTO public.cities (id, name) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Mumbai');

-- Add city_id to events
ALTER TABLE public.events ADD COLUMN city_id UUID REFERENCES public.cities(id);

-- Add city_id to locations
ALTER TABLE public.locations ADD COLUMN city_id UUID REFERENCES public.cities(id);

-- Backfill existing data with Mumbai
UPDATE public.events SET city_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
UPDATE public.locations SET city_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

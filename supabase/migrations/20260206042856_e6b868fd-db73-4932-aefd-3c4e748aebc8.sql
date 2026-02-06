-- Create event_type enum
CREATE TYPE public.event_type AS ENUM ('one_off', 'recurring');

-- Create format_type enum  
CREATE TYPE public.format_type AS ENUM ('mystery_partner', 'round_robin', 'format_3', 'format_4', 'format_5');

-- Create events table
CREATE TABLE public.events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  event_type event_type NOT NULL DEFAULT 'one_off',
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on events
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Anyone can view events
CREATE POLICY "Anyone can view events"
ON public.events
FOR SELECT
USING (true);

-- Create locations table
CREATE TABLE public.locations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on locations
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

-- Anyone can view locations
CREATE POLICY "Anyone can view locations"
ON public.locations
FOR SELECT
USING (true);

-- Add new columns to courts table
ALTER TABLE public.courts 
ADD COLUMN event_id uuid REFERENCES public.events(id),
ADD COLUMN location_id uuid REFERENCES public.locations(id),
ADD COLUMN format_type format_type NOT NULL DEFAULT 'mystery_partner';

-- Seed events
INSERT INTO public.events (id, name, event_type, active) VALUES 
  ('11111111-1111-1111-1111-111111111111', 'Goosepick Social', 'one_off', true),
  ('22222222-2222-2222-2222-222222222222', 'Goosepick Thursdays', 'recurring', true);

-- Seed locations for Goosepick Thursdays
INSERT INTO public.locations (event_id, name, active) VALUES 
  ('22222222-2222-2222-2222-222222222222', 'Bandra', true),
  ('22222222-2222-2222-2222-222222222222', 'Andheri', true);

-- Update existing courts to belong to Goosepick Social event
UPDATE public.courts SET event_id = '11111111-1111-1111-1111-111111111111';
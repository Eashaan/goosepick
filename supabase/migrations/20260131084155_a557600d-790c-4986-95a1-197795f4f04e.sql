-- Add status tracking columns to matches table
ALTER TABLE public.matches 
ADD COLUMN status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
ADD COLUMN started_at timestamp with time zone,
ADD COLUMN completed_at timestamp with time zone,
ADD COLUMN override_played boolean NOT NULL DEFAULT false;
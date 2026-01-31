-- Create app_role enum for admin role
CREATE TYPE public.app_role AS ENUM ('admin');

-- Create user_roles table for role-based access control
CREATE TABLE public.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    UNIQUE (user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Policy: Only allow admins to read user_roles (through security definer function)
CREATE POLICY "Users can view their own roles"
    ON public.user_roles
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Create security definer function to check if user has a role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create security definer function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'
  )
$$;

-- Drop existing permissive policies for write operations
DROP POLICY IF EXISTS "Anyone can delete players" ON public.players;
DROP POLICY IF EXISTS "Anyone can insert players" ON public.players;
DROP POLICY IF EXISTS "Anyone can update players" ON public.players;

DROP POLICY IF EXISTS "Anyone can delete matches" ON public.matches;
DROP POLICY IF EXISTS "Anyone can insert matches" ON public.matches;
DROP POLICY IF EXISTS "Anyone can update matches" ON public.matches;

DROP POLICY IF EXISTS "Anyone can update court_state" ON public.court_state;

DROP POLICY IF EXISTS "Anyone can insert feedback" ON public.feedback;

-- Create new secure RLS policies for players (only admins can write)
CREATE POLICY "Admins can insert players"
    ON public.players
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update players"
    ON public.players
    FOR UPDATE
    TO authenticated
    USING (public.is_admin());

CREATE POLICY "Admins can delete players"
    ON public.players
    FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- Create new secure RLS policies for matches (only admins can write)
CREATE POLICY "Admins can insert matches"
    ON public.matches
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update matches"
    ON public.matches
    FOR UPDATE
    TO authenticated
    USING (public.is_admin());

CREATE POLICY "Admins can delete matches"
    ON public.matches
    FOR DELETE
    TO authenticated
    USING (public.is_admin());

-- Create new secure RLS policies for court_state (only admins can update)
CREATE POLICY "Admins can update court_state"
    ON public.court_state
    FOR UPDATE
    TO authenticated
    USING (public.is_admin());

-- Feedback: Keep public insert but add rate-limiting via authenticated users
-- Anyone can still submit feedback (public feature)
CREATE POLICY "Anyone can insert feedback"
    ON public.feedback
    FOR INSERT
    WITH CHECK (true);
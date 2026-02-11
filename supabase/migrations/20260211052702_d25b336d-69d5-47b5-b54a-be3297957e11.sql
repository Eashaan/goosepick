
-- Allow admins to insert courts
CREATE POLICY "Admins can insert courts"
ON public.courts
FOR INSERT
WITH CHECK (is_admin());

-- Allow admins to update courts
CREATE POLICY "Admins can update courts"
ON public.courts
FOR UPDATE
USING (is_admin());

-- Allow admins to delete courts
CREATE POLICY "Admins can delete courts"
ON public.courts
FOR DELETE
USING (is_admin());

-- Allow admins to insert court_state
CREATE POLICY "Admins can insert court_state"
ON public.court_state
FOR INSERT
WITH CHECK (is_admin());

-- Allow admins to delete court_state
CREATE POLICY "Admins can delete court_state"
ON public.court_state
FOR DELETE
USING (is_admin());

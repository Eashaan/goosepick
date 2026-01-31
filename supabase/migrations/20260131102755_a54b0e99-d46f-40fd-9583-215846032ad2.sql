-- Add explicit deny policies for write operations on user_roles table
-- This prevents privilege escalation attacks by explicitly denying all client-side writes
-- Role management should only be done via service role or direct database access

-- Deny all INSERT operations (roles must be assigned via service role/backend)
CREATE POLICY "Deny all user role inserts"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

-- Deny all UPDATE operations
CREATE POLICY "Deny all user role updates"
  ON public.user_roles
  FOR UPDATE
  TO authenticated
  USING (false);

-- Deny all DELETE operations
CREATE POLICY "Deny all user role deletes"
  ON public.user_roles
  FOR DELETE
  TO authenticated
  USING (false);
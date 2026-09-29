-- ── Role helpers ──
CREATE OR REPLACE FUNCTION public.staff_role(_user_id uuid)
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.user_roles WHERE user_id = _user_id
  ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'host' THEN 3 WHEN 'viewer' THEN 4 ELSE 9 END
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.staff_role(auth.uid())::text
$$;

-- Explicit permission map (not enum order). Extensible: add scope checks here later.
CREATE OR REPLACE FUNCTION public.has_permission(p_permission text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE public.staff_role(auth.uid())::text
    WHEN 'owner' THEN true
    WHEN 'admin' THEN p_permission IN ('admin.read','event.operate','seats.manage','schedule.manage','capacity.manage','social.create','shopify.manage')
    WHEN 'host'  THEN p_permission IN ('admin.read','event.operate','seats.manage')
    WHEN 'viewer' THEN p_permission IN ('admin.read')
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'owner')
$$;

-- is_admin now means owner OR admin (management-level). Hosts/viewers never pass it.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('owner','admin'))
$$;

CREATE OR REPLACE FUNCTION public.is_event_operator()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('owner','admin','host'))
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('owner','admin','host','viewer'))
$$;

REVOKE ALL ON FUNCTION public.staff_role(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_role(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.current_staff_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_permission(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_staff_role(), public.has_permission(text), public.is_owner() TO authenticated, service_role;
-- used inside RLS policies that may be evaluated for anon; they return false without a session
REVOKE ALL ON FUNCTION public.is_event_operator(), public.is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_event_operator(), public.is_staff() TO anon, authenticated, service_role;

-- ── Last-owner protection ──
CREATE OR REPLACE FUNCTION public.protect_last_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role = 'owner' AND (TG_OP = 'DELETE' OR NEW.role <> 'owner') THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'owner' AND id <> OLD.id) THEN
      RAISE EXCEPTION 'Cannot remove or demote the last owner';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION public.protect_last_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS protect_last_owner ON public.user_roles;
CREATE TRIGGER protect_last_owner BEFORE UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_last_owner();

-- ── Migrate existing admin to owner ──
UPDATE public.user_roles SET role = 'owner'
WHERE role = 'admin' AND user_id = (SELECT id FROM auth.users WHERE lower(email) = 'eashaanb@gmail.com');

-- ── Event-day RPCs: owner/admin/host ──
DO $$
DECLARE f record; d text;
BEGIN
  FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'admin_add_manual_seat','admin_update_seat','admin_cancel_manual_seat','assign_registration_to_roster',
      'start_match_atomic','end_match_atomic','start_group_match_atomic','end_group_match_atomic')
  LOOP
    d := replace(pg_get_functiondef(f.oid), 'is_admin()', 'is_event_operator()');
    EXECUTE d;
  END LOOP;
END $$;

-- ── RLS: least privilege per table/command ──
DO $$
DECLARE r record; newq text; newc text; stmt text; fn text;
  ops text[] := ARRAY['players','matches','court_state','session_configs','court_groups','courts','court_units',
                      'sessions','rotation_audit','group_court_state','group_physical_courts','match_substitutions'];
BEGIN
  FOR r IN SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
    WHERE schemaname = 'public' AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%is_admin()%'
  LOOP
    fn := NULL;
    IF r.cmd = 'SELECT' THEN
      IF r.tablename IN ('commerce_webhook_events','commerce_orders') THEN fn := NULL;
      ELSIF r.tablename = 'participant_profiles' THEN fn := 'is_event_operator()';
      ELSE fn := 'is_staff()'; END IF;
    ELSIF r.tablename = ANY(ops) AND NOT (r.tablename = 'sessions' AND r.cmd = 'DELETE') THEN
      fn := 'is_event_operator()';
    END IF;
    CONTINUE WHEN fn IS NULL;
    newq := replace(r.qual, 'is_admin()', fn);
    newc := replace(r.with_check, 'is_admin()', fn);
    stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF newq IS NOT NULL THEN stmt := stmt || ' USING (' || newq || ')'; END IF;
    IF newc IS NOT NULL THEN stmt := stmt || ' WITH CHECK (' || newc || ')'; END IF;
    EXECUTE stmt;
  END LOOP;
END $$;
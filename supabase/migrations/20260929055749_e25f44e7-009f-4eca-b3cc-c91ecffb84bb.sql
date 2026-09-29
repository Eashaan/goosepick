DO $$ DECLARE t text; p text; BEGIN
FOR t, p IN SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' AND cmd='SELECT' AND qual='true' AND tablename IN ('court_groups','court_units','group_physical_courts') LOOP
  EXECUTE format('DROP POLICY %I ON public.%I', p, t);
  EXECUTE format('CREATE POLICY "Public can view %s of visible sessions" ON public.%I FOR SELECT USING (public.is_admin() OR session_id IS NULL OR EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = %I.session_id))', t, t, t);
END LOOP; END $$;
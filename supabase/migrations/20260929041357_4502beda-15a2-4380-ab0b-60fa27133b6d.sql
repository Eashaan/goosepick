ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS capacity_source text;
ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_capacity_source_check;
ALTER TABLE public.sessions ADD CONSTRAINT sessions_capacity_source_check
  CHECK (capacity_source IS NULL OR capacity_source IN ('inherited','manual'));

-- New recurring sessions record that their capacity came from the schedule default.
CREATE OR REPLACE FUNCTION public.set_recurring_capacity_source()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.recurring_schedule_id IS NOT NULL AND NEW.capacity_source IS NULL THEN
    NEW.capacity_source := 'inherited';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sessions_recurring_capacity_source ON public.sessions;
CREATE TRIGGER trg_sessions_recurring_capacity_source
  BEFORE INSERT ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_recurring_capacity_source();

CREATE OR REPLACE FUNCTION public.admin_set_session_capacity(p_session_id uuid, p_capacity integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_booked integer;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;
  IF p_capacity IS NOT NULL AND p_capacity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Capacity must be a positive number, or empty for no limit');
  END IF;
  UPDATE public.sessions SET capacity = p_capacity, capacity_source = 'manual' WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session not found');
  END IF;
  v_booked := public.session_booked_seats(p_session_id);
  RETURN jsonb_build_object('ok', true, 'capacity', p_capacity, 'booked', v_booked,
    'over_capacity', p_capacity IS NOT NULL AND v_booked > p_capacity);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_set_schedule_default_capacity(p_schedule_id uuid, p_capacity integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;
  IF p_capacity IS NOT NULL AND (p_capacity <= 0 OR p_capacity > 10000) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Default capacity must be between 1 and 10000, or empty for no limit');
  END IF;
  UPDATE public.recurring_experience_schedules SET default_capacity = p_capacity WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Schedule not found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'default_capacity', p_capacity);
END $$;

CREATE OR REPLACE FUNCTION public.admin_apply_schedule_capacity(p_schedule_id uuid, p_include_overrides boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_cap integer;
  r record;
  v_booked integer;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;
  SELECT default_capacity INTO v_cap FROM public.recurring_experience_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Schedule not found');
  END IF;

  FOR r IN
    SELECT id, date, capacity, capacity_source FROM public.sessions
    WHERE recurring_schedule_id = p_schedule_id
      AND status = 'draft' AND NOT is_active
      AND date >= CURRENT_DATE
    ORDER BY date
    FOR UPDATE
  LOOP
    IF r.capacity_source = 'manual' AND NOT p_include_overrides THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;
    IF r.capacity IS NOT DISTINCT FROM v_cap AND r.capacity_source = 'inherited' THEN
      v_skipped := v_skipped + 1; CONTINUE;
    END IF;
    v_booked := public.session_booked_seats(r.id);
    IF v_cap IS NOT NULL AND v_booked > v_cap THEN
      v_conflicts := v_conflicts || jsonb_build_object('session_id', r.id, 'date', r.date, 'booked', v_booked, 'capacity', v_cap);
      CONTINUE;
    END IF;
    UPDATE public.sessions SET capacity = v_cap, capacity_source = 'inherited' WHERE id = r.id;
    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'default_capacity', v_cap, 'updated', v_updated,
    'skipped', v_skipped, 'conflicts', v_conflicts);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_schedule_default_capacity(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_apply_schedule_capacity(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_schedule_default_capacity(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_apply_schedule_capacity(uuid, boolean) TO authenticated, service_role;
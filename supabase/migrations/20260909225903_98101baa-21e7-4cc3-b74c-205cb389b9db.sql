-- ============================================================
-- Scheduling layer: recurring Thursdays + manual Social
-- ============================================================

CREATE TABLE public.recurring_experience_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES public.cities(id),
  event_type public.scope_event_type NOT NULL DEFAULT 'thursdays',
  location_id uuid REFERENCES public.locations(id),
  weekday smallint NOT NULL DEFAULT 4 CHECK (weekday BETWEEN 0 AND 6),
  horizon_weeks integer NOT NULL DEFAULT 8 CHECK (horizon_weeks BETWEEN 1 AND 26),
  start_date date,
  end_date date,
  shopify_product_id text NOT NULL,
  shopify_variant_id text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  default_capacity integer CHECK (default_capacity IS NULL OR default_capacity > 0),
  last_reconciled_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_schedules_thursdays_only CHECK (event_type = 'thursdays'),
  CONSTRAINT recurring_schedules_location_required CHECK (location_id IS NOT NULL)
);

GRANT SELECT ON public.recurring_experience_schedules TO authenticated;
GRANT ALL ON public.recurring_experience_schedules TO service_role;
ALTER TABLE public.recurring_experience_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read recurring schedules" ON public.recurring_experience_schedules
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE UNIQUE INDEX recurring_schedules_active_scope_key
  ON public.recurring_experience_schedules (city_id, event_type, location_id, shopify_variant_id, weekday)
  WHERE is_active;

CREATE TRIGGER recurring_experience_schedules_set_updated_at
  BEFORE UPDATE ON public.recurring_experience_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.recurring_experience_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.recurring_experience_schedules(id) ON DELETE CASCADE,
  date date NOT NULL,
  skipped boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, date)
);

GRANT SELECT ON public.recurring_experience_exceptions TO authenticated;
GRANT ALL ON public.recurring_experience_exceptions TO service_role;
ALTER TABLE public.recurring_experience_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read schedule exceptions" ON public.recurring_experience_exceptions
  FOR SELECT TO authenticated USING (public.is_admin());

CREATE TRIGGER recurring_experience_exceptions_set_updated_at
  BEFORE UPDATE ON public.recurring_experience_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sessions: optional capacity + provenance back to the schedule
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS capacity integer,
  ADD COLUMN IF NOT EXISTS recurring_schedule_id uuid REFERENCES public.recurring_experience_schedules(id) ON DELETE SET NULL;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_capacity_positive CHECK (capacity IS NULL OR capacity > 0);

CREATE INDEX IF NOT EXISTS sessions_recurring_schedule_date_idx
  ON public.sessions (recurring_schedule_id, date);

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gp_random_token(p_len integer DEFAULT 6)
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT string_agg(substr('23456789abcdefghjkmnpqrstuvwxyz', 1 + floor(random() * 30)::int, 1), '')
  FROM generate_series(1, p_len);
$$;

-- Seats that legitimately consume capacity: paid and not terminal.
CREATE OR REPLACE FUNCTION public.session_booked_seats(p_session_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int
  FROM public.experience_registrations
  WHERE session_id = p_session_id
    AND status IN ('paid', 'profile_required', 'confirmed')
    AND cancelled_at IS NULL
    AND refunded_at IS NULL
$$;

REVOKE ALL ON FUNCTION public.gp_random_token(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.session_booked_seats(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.session_booked_seats(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.session_booked_seats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gp_random_token(integer) TO service_role;

-- Does this session already carry registrations or event-day setup?
CREATE OR REPLACE FUNCTION public.session_has_operational_data(p_session_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.experience_registrations WHERE session_id = p_session_id)
      OR EXISTS (SELECT 1 FROM public.players WHERE session_id = p_session_id)
      OR EXISTS (SELECT 1 FROM public.matches WHERE session_id = p_session_id)
      OR EXISTS (SELECT 1 FROM public.courts WHERE session_id = p_session_id)
      OR EXISTS (SELECT 1 FROM public.court_units WHERE session_id = p_session_id)
      OR EXISTS (SELECT 1 FROM public.court_groups WHERE session_id = p_session_id)
      OR EXISTS (SELECT 1 FROM public.session_configs WHERE session_id = p_session_id)
$$;
REVOKE ALL ON FUNCTION public.session_has_operational_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.session_has_operational_data(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.session_has_operational_data(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Idempotent reconciliation (internal; cron + admin wrapper call it)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reconcile_recurring_schedules(p_schedule_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record;
  d date;
  v_session_id uuid;
  v_key text;
  v_city text;
  v_loc text;
  v_created_sessions integer := 0;
  v_adopted integer := 0;
  v_created_mappings integer := 0;
  v_created jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  FOR s IN
    SELECT * FROM public.recurring_experience_schedules
    WHERE is_active AND (p_schedule_id IS NULL OR id = p_schedule_id)
    ORDER BY created_at
  LOOP
    BEGIN
      SELECT name INTO v_city FROM public.cities WHERE id = s.city_id;
      SELECT name INTO v_loc FROM public.locations WHERE id = s.location_id;

      FOR d IN
        SELECT g::date
        FROM generate_series(
          GREATEST(COALESCE(s.start_date, CURRENT_DATE), CURRENT_DATE),
          (CURRENT_DATE + (s.horizon_weeks * 7))::date,
          interval '1 day'
        ) g
        WHERE EXTRACT(dow FROM g) = s.weekday
          AND (s.end_date IS NULL OR g::date <= s.end_date)
        ORDER BY g
      LOOP
        IF EXISTS (
          SELECT 1 FROM public.recurring_experience_exceptions e
          WHERE e.schedule_id = s.id AND e.date = d AND e.skipped
        ) THEN
          CONTINUE;
        END IF;

        SELECT id INTO v_session_id
        FROM public.sessions
        WHERE city_id = s.city_id
          AND event_type = s.event_type
          AND location_id IS NOT DISTINCT FROM s.location_id
          AND date = d;

        IF v_session_id IS NULL THEN
          INSERT INTO public.sessions (
            city_id, event_type, location_id, date, is_active, status,
            session_label, recurring_schedule_id, capacity
          ) VALUES (
            s.city_id, s.event_type, s.location_id, d, false, 'draft',
            concat_ws(' ', 'Goosepick Thursdays', v_city, v_loc) || ' — ' || to_char(d, 'FMMon FMDD, YYYY'),
            s.id, s.default_capacity
          )
          RETURNING id INTO v_session_id;
          v_created_sessions := v_created_sessions + 1;
          v_created := v_created || jsonb_build_object(
            'date', d, 'city', v_city, 'location', v_loc, 'session_id', v_session_id
          );
        ELSE
          UPDATE public.sessions
          SET recurring_schedule_id = s.id
          WHERE id = v_session_id AND recurring_schedule_id IS NULL;
          v_adopted := v_adopted + 1;
        END IF;

        -- Reuse this session's existing occurrence key; never regenerate one.
        SELECT occurrence_key INTO v_key
        FROM public.shopify_session_mappings
        WHERE session_id = v_session_id AND occurrence_key IS NOT NULL
        ORDER BY created_at
        LIMIT 1;

        IF v_key IS NULL THEN
          v_key := 'gp_' || substr(replace(v_session_id::text, '-', ''), 1, 8) || '_' || public.gp_random_token(6);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM public.shopify_session_mappings m
          WHERE m.session_id = v_session_id
            AND public.shopify_numeric_id(m.shopify_product_id) = public.shopify_numeric_id(s.shopify_product_id)
            AND public.shopify_numeric_id(m.shopify_variant_id) = public.shopify_numeric_id(s.shopify_variant_id)
            AND m.is_active
        ) THEN
          UPDATE public.shopify_session_mappings
          SET is_active = true, session_date = d
          WHERE session_id = v_session_id
            AND public.shopify_numeric_id(shopify_product_id) = public.shopify_numeric_id(s.shopify_product_id)
            AND public.shopify_numeric_id(shopify_variant_id) = public.shopify_numeric_id(s.shopify_variant_id);

          IF NOT FOUND THEN
            INSERT INTO public.shopify_session_mappings (
              mapping_key, occurrence_key, shopify_product_id, shopify_variant_id,
              city_id, event_type, location_id, session_date, session_id, is_active, metadata
            ) VALUES (
              v_key || '_v' || right(public.shopify_numeric_id(s.shopify_variant_id), 6),
              v_key,
              public.shopify_numeric_id(s.shopify_product_id),
              public.shopify_numeric_id(s.shopify_variant_id),
              s.city_id, s.event_type, s.location_id, d, v_session_id, true,
              jsonb_build_object(
                'created_via', 'recurring_schedule',
                'schedule_id', s.id,
                'label', concat_ws(' · ', v_city, v_loc)
              )
            );
            v_created_mappings := v_created_mappings + 1;
          END IF;
        END IF;
      END LOOP;

      UPDATE public.recurring_experience_schedules
      SET last_reconciled_at = now(), last_error = NULL
      WHERE id = s.id;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('schedule_id', s.id, 'error', SQLERRM);
      UPDATE public.recurring_experience_schedules
      SET last_reconciled_at = now(), last_error = SQLERRM
      WHERE id = s.id;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'sessions_created', v_created_sessions,
    'sessions_adopted', v_adopted,
    'mappings_created', v_created_mappings,
    'created', v_created,
    'errors', v_errors
  );
END $$;

REVOKE ALL ON FUNCTION public.reconcile_recurring_schedules(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_recurring_schedules(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reconcile_recurring_schedules(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_recurring_schedules(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_reconcile_recurring_schedules(p_schedule_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;
  RETURN public.reconcile_recurring_schedules(p_schedule_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_reconcile_recurring_schedules(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_reconcile_recurring_schedules(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_recurring_schedules(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Schedule management
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_upsert_recurring_schedule(
  p_city_id uuid,
  p_location_id uuid,
  p_shopify_product_id text,
  p_shopify_variant_id text,
  p_weekday smallint DEFAULT 4,
  p_horizon_weeks integer DEFAULT 8,
  p_default_capacity integer DEFAULT NULL,
  p_start_date date DEFAULT NULL,
  p_end_date date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product text := public.shopify_numeric_id(p_shopify_product_id);
  v_variant text := public.shopify_numeric_id(p_shopify_variant_id);
  v_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;
  IF p_city_id IS NULL OR p_location_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'City and locality are required');
  END IF;
  IF v_product IS NULL OR v_variant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'An exact Shopify product and variant are required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = p_location_id AND city_id = p_city_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Locality does not belong to this city');
  END IF;

  SELECT id INTO v_id
  FROM public.recurring_experience_schedules
  WHERE city_id = p_city_id
    AND event_type = 'thursdays'
    AND location_id = p_location_id
    AND shopify_variant_id = v_variant
    AND weekday = p_weekday
    AND is_active;

  IF v_id IS NOT NULL THEN
    UPDATE public.recurring_experience_schedules
    SET horizon_weeks = p_horizon_weeks,
        default_capacity = p_default_capacity,
        start_date = p_start_date,
        end_date = p_end_date,
        shopify_product_id = v_product
    WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'status', 'updated', 'schedule_id', v_id);
  END IF;

  INSERT INTO public.recurring_experience_schedules (
    city_id, event_type, location_id, weekday, horizon_weeks,
    start_date, end_date, shopify_product_id, shopify_variant_id, default_capacity
  ) VALUES (
    p_city_id, 'thursdays', p_location_id, p_weekday, p_horizon_weeks,
    p_start_date, p_end_date, v_product, v_variant, p_default_capacity
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'status', 'created', 'schedule_id', v_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_upsert_recurring_schedule(uuid, uuid, text, text, smallint, integer, integer, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_upsert_recurring_schedule(uuid, uuid, text, text, smallint, integer, integer, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_recurring_schedule(uuid, uuid, text, text, smallint, integer, integer, date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_recurring_schedule_active(p_schedule_id uuid, p_active boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;
  UPDATE public.recurring_experience_schedules SET is_active = p_active WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Schedule not found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'schedule_id', p_schedule_id, 'is_active', p_active);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_recurring_schedule_active(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_recurring_schedule_active(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_recurring_schedule_active(uuid, boolean) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Skip / unskip a date
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_skip_recurring_date(p_schedule_id uuid, p_date date, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.recurring_experience_schedules%ROWTYPE;
  v_session public.sessions%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;
  SELECT * INTO s FROM public.recurring_experience_schedules WHERE id = p_schedule_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Schedule not found');
  END IF;
  IF p_date IS NULL OR p_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only today or a future date can be skipped');
  END IF;

  SELECT * INTO v_session
  FROM public.sessions
  WHERE city_id = s.city_id
    AND event_type = s.event_type
    AND location_id IS NOT DISTINCT FROM s.location_id
    AND date = p_date
  FOR UPDATE;

  IF FOUND THEN
    IF v_session.status <> 'draft' THEN
      RETURN jsonb_build_object('ok', false, 'conflict', 'session_not_draft',
        'error', 'This date is already ' || v_session.status || '. Handle it from the session before skipping.',
        'session_id', v_session.id);
    END IF;
    IF public.session_has_operational_data(v_session.id) THEN
      RETURN jsonb_build_object('ok', false, 'conflict', 'has_registrations_or_setup',
        'error', 'This date already has registrations or event-day setup. Cancel or move those seats first.',
        'session_id', v_session.id,
        'booked', public.session_booked_seats(v_session.id));
    END IF;

    UPDATE public.shopify_session_mappings
    SET is_active = false
    WHERE session_id = v_session.id;

    DELETE FROM public.sessions WHERE id = v_session.id;
  END IF;

  INSERT INTO public.recurring_experience_exceptions (schedule_id, date, skipped, note)
  VALUES (p_schedule_id, p_date, true, p_note)
  ON CONFLICT (schedule_id, date) DO UPDATE SET skipped = true, note = COALESCE(EXCLUDED.note, public.recurring_experience_exceptions.note);

  RETURN jsonb_build_object('ok', true, 'status', 'skipped', 'date', p_date);
END $$;

REVOKE ALL ON FUNCTION public.admin_skip_recurring_date(uuid, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_skip_recurring_date(uuid, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_skip_recurring_date(uuid, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_unskip_recurring_date(p_schedule_id uuid, p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;
  DELETE FROM public.recurring_experience_exceptions
  WHERE schedule_id = p_schedule_id AND date = p_date;

  v_result := public.reconcile_recurring_schedules(p_schedule_id);
  RETURN jsonb_build_object('ok', true, 'status', 'restored', 'date', p_date, 'reconcile', v_result);
END $$;

REVOKE ALL ON FUNCTION public.admin_unskip_recurring_date(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_unskip_recurring_date(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_unskip_recurring_date(uuid, date) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Capacity
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_session_capacity(p_session_id uuid, p_capacity integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booked integer;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;
  IF p_capacity IS NOT NULL AND p_capacity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Capacity must be a positive number, or empty for no limit');
  END IF;
  UPDATE public.sessions SET capacity = p_capacity WHERE id = p_session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session not found');
  END IF;
  v_booked := public.session_booked_seats(p_session_id);
  RETURN jsonb_build_object('ok', true, 'capacity', p_capacity, 'booked', v_booked,
    'over_capacity', p_capacity IS NOT NULL AND v_booked > p_capacity);
END $$;

REVOKE ALL ON FUNCTION public.admin_set_session_capacity(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_session_capacity(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_session_capacity(uuid, integer) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Manual Social occurrence creation
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_create_social_occurrence(
  p_city_id uuid,
  p_date date,
  p_shopify_product_id text,
  p_variant_ids text[],
  p_capacity integer DEFAULT NULL,
  p_label text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_product text := public.shopify_numeric_id(p_shopify_product_id);
  v_variant text;
  v_raw text;
  v_session_id uuid;
  v_status public.session_status;
  v_key text;
  v_city text;
  v_created integer := 0;
  v_existing integer := 0;
  v_reused boolean := false;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;
  IF p_city_id IS NULL OR p_date IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'City and date are required');
  END IF;
  IF p_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pick today or a future date');
  END IF;
  IF v_product IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A Shopify product is required');
  END IF;
  IF p_variant_ids IS NULL OR array_length(p_variant_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Select at least one ticket type');
  END IF;
  IF p_capacity IS NOT NULL AND p_capacity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Capacity must be a positive number');
  END IF;
  SELECT name INTO v_city FROM public.cities WHERE id = p_city_id AND active;
  IF v_city IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'City not found');
  END IF;

  SELECT id, status INTO v_session_id, v_status
  FROM public.sessions
  WHERE city_id = p_city_id
    AND event_type = 'social'
    AND location_id IS NULL
    AND date = p_date;

  IF v_session_id IS NOT NULL THEN
    IF v_status <> 'draft' THEN
      RETURN jsonb_build_object('ok', false, 'conflict', 'session_not_draft',
        'error', 'A ' || v_status || ' Social already exists for this city and date.',
        'session_id', v_session_id);
    END IF;
    v_reused := true;
    IF p_capacity IS NOT NULL THEN
      UPDATE public.sessions SET capacity = p_capacity WHERE id = v_session_id;
    END IF;
  ELSE
    INSERT INTO public.sessions (city_id, event_type, location_id, date, is_active, status, session_label, capacity)
    VALUES (p_city_id, 'social', NULL, p_date, false, 'draft',
            COALESCE(NULLIF(btrim(p_label), ''),
                     concat_ws(' ', 'Goosepick Social', v_city) || ' — ' || to_char(p_date, 'FMMon FMDD, YYYY')),
            p_capacity)
    RETURNING id INTO v_session_id;
  END IF;

  SELECT occurrence_key INTO v_key
  FROM public.shopify_session_mappings
  WHERE session_id = v_session_id AND occurrence_key IS NOT NULL
  ORDER BY created_at LIMIT 1;
  IF v_key IS NULL THEN
    v_key := 'gp_' || substr(replace(v_session_id::text, '-', ''), 1, 8) || '_' || public.gp_random_token(6);
  END IF;

  FOREACH v_raw IN ARRAY p_variant_ids LOOP
    v_variant := public.shopify_numeric_id(v_raw);
    IF v_variant IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'One of the ticket types is not a valid Shopify variant id');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.shopify_session_mappings m
      WHERE public.shopify_numeric_id(m.shopify_variant_id) = v_variant
        AND m.session_date = p_date
        AND m.is_active
        AND m.session_id IS DISTINCT FROM v_session_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'conflict', 'variant_already_mapped',
        'error', 'That ticket type is already linked to another occurrence on this date.');
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.shopify_session_mappings m
      WHERE m.session_id = v_session_id
        AND public.shopify_numeric_id(m.shopify_variant_id) = v_variant
        AND m.is_active
    ) THEN
      v_existing := v_existing + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.shopify_session_mappings (
      mapping_key, occurrence_key, shopify_product_id, shopify_variant_id,
      city_id, event_type, location_id, session_date, session_id, is_active, metadata
    ) VALUES (
      v_key || '_v' || right(v_variant, 6), v_key, v_product, v_variant,
      p_city_id, 'social', NULL, p_date, v_session_id, true,
      jsonb_build_object('created_via', 'admin_social_form', 'label', concat_ws(' · ', v_city, 'Goosepick Social'))
    );
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'session_id', v_session_id, 'occurrence_key', v_key,
    'reused_session', v_reused, 'mappings_created', v_created, 'mappings_existing', v_existing,
    'date', p_date, 'capacity', p_capacity);
END $$;

REVOKE ALL ON FUNCTION public.admin_create_social_occurrence(uuid, date, text, text[], integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_social_occurrence(uuid, date, text, text[], integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_create_social_occurrence(uuid, date, text, text[], integer, text) TO authenticated, service_role;
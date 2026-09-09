CREATE OR REPLACE FUNCTION public.admin_set_shopify_session_date(
  p_session_id uuid,
  p_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_status public.session_status;
  v_updated integer := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;

  IF p_session_id IS NULL OR p_date IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session and date are required');
  END IF;

  IF p_date < CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pick today or a future date');
  END IF;

  SELECT status INTO v_status FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session not found');
  END IF;
  IF v_status <> 'draft' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Only a draft session can be rescheduled');
  END IF;

  UPDATE public.sessions SET date = p_date WHERE id = p_session_id;

  UPDATE public.shopify_session_mappings
  SET session_date = p_date, updated_at = now()
  WHERE session_id = p_session_id AND session_date IS DISTINCT FROM p_date;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'session_id', p_session_id, 'date', p_date, 'mappings_updated', v_updated);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_set_shopify_session_date(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_shopify_session_date(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_shopify_session_date(uuid, date) TO authenticated, service_role;
ALTER TABLE public.experience_registrations
  ADD COLUMN IF NOT EXISTS seat_source text NOT NULL DEFAULT 'shopify',
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS created_by_admin boolean NOT NULL DEFAULT false;
ALTER TABLE public.experience_registrations
  ADD CONSTRAINT experience_registrations_seat_source_check
  CHECK (seat_source IN ('shopify','offline_paid','complimentary','invite','walk_in','manual'));
-- Manual seats carry no Shopify line item.
ALTER TABLE public.experience_registrations ALTER COLUMN shopify_line_item_id DROP NOT NULL;
ALTER TABLE public.experience_registrations
  ADD CONSTRAINT experience_registrations_manual_no_commerce_check
  CHECK (seat_source = 'shopify' OR (commerce_order_id IS NULL AND shopify_line_item_id IS NULL AND mapping_id IS NULL));

CREATE OR REPLACE FUNCTION public.admin_add_manual_seat(
  p_session_id uuid, p_source text, p_name text,
  p_email text DEFAULT NULL, p_phone text DEFAULT NULL, p_skill text DEFAULT NULL,
  p_note text DEFAULT NULL, p_allow_over_capacity boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_s record; v_booked int; v_id uuid; v_next int;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('ok',false,'message','Not authorized'); END IF;
  IF p_source NOT IN ('offline_paid','complimentary','invite','walk_in','manual') THEN
    RETURN jsonb_build_object('ok',false,'message','Invalid seat source'); END IF;
  IF coalesce(trim(p_name),'') = '' THEN RETURN jsonb_build_object('ok',false,'message','Name is required'); END IF;
  SELECT * INTO v_s FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'message','Session not found'); END IF;
  IF v_s.status = 'ended' THEN RETURN jsonb_build_object('ok',false,'message','Session has ended'); END IF;
  v_booked := public.session_booked_seats(p_session_id);
  IF v_s.capacity IS NOT NULL AND v_booked >= v_s.capacity AND NOT coalesce(p_allow_over_capacity,false) THEN
    RETURN jsonb_build_object('ok',false,'conflict',true,'message','Session is at capacity','booked',v_booked,'capacity',v_s.capacity);
  END IF;
  SELECT coalesce(max(seat_index),0)+1 INTO v_next FROM public.experience_registrations
    WHERE session_id = p_session_id AND seat_source <> 'shopify';
  INSERT INTO public.experience_registrations (session_id, seat_index, status, participant_name, participant_email,
    participant_phone, selected_skill_level, admin_note, seat_source, created_by_admin)
  VALUES (p_session_id, v_next, 'confirmed', trim(p_name), nullif(lower(trim(p_email)),''), nullif(trim(p_phone),''),
    CASE WHEN v_s.event_type = 'thursdays' THEN nullif(trim(p_skill),'') END, nullif(trim(p_note),''), p_source, true)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'id',v_id,'booked',v_booked+1,'capacity',v_s.capacity,
    'over_capacity', v_s.capacity IS NOT NULL AND v_booked+1 > v_s.capacity);
END $$;

CREATE OR REPLACE FUNCTION public.admin_update_seat(
  p_registration_id uuid, p_name text, p_email text, p_phone text, p_skill text, p_note text,
  p_source text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r record;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('ok',false,'message','Not authorized'); END IF;
  SELECT * INTO v_r FROM public.experience_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'message','Seat not found'); END IF;
  IF v_r.seat_source <> 'shopify' AND coalesce(trim(p_name),'') = '' THEN
    RETURN jsonb_build_object('ok',false,'message','Name is required'); END IF;
  IF p_source IS NOT NULL AND (v_r.seat_source = 'shopify' OR p_source NOT IN ('offline_paid','complimentary','invite','walk_in','manual')) THEN
    RETURN jsonb_build_object('ok',false,'message','Seat source cannot be changed'); END IF;
  -- Only descriptive fields; commerce linkage, status, session and Shopify ids are never touched.
  UPDATE public.experience_registrations SET
    participant_name = nullif(trim(p_name),''),
    participant_email = nullif(lower(trim(p_email)),''),
    participant_phone = nullif(trim(p_phone),''),
    selected_skill_level = nullif(trim(p_skill),''),
    admin_note = nullif(trim(p_note),''),
    seat_source = coalesce(p_source, seat_source),
    updated_at = now()
  WHERE id = p_registration_id;
  RETURN jsonb_build_object('ok',true,'id',p_registration_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_cancel_manual_seat(p_registration_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r record;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('ok',false,'message','Not authorized'); END IF;
  SELECT * INTO v_r FROM public.experience_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'message','Seat not found'); END IF;
  IF v_r.seat_source = 'shopify' THEN RETURN jsonb_build_object('ok',false,'message','Shopify seats are managed through Shopify'); END IF;
  IF v_r.status = 'cancelled' THEN RETURN jsonb_build_object('ok',true,'id',p_registration_id,'already',true); END IF;
  UPDATE public.experience_registrations SET status='cancelled', cancelled_at=now(), updated_at=now() WHERE id=p_registration_id;
  RETURN jsonb_build_object('ok',true,'id',p_registration_id);
END $$;

-- Purchaser can name their own unclaimed guest seats (never others', never their own claimed seat).
CREATE OR REPLACE FUNCTION public.participant_update_guest_seat(
  p_registration_id uuid, p_name text, p_email text DEFAULT NULL, p_phone text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid := public.current_participant_profile_id(); v_r record;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Not signed in'); END IF;
  SELECT * INTO v_r FROM public.experience_registrations WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND OR v_r.purchaser_profile_id IS DISTINCT FROM v_me OR v_r.profile_id IS NOT NULL
     OR v_r.status NOT IN ('paid','profile_required','confirmed') THEN
    RETURN jsonb_build_object('ok',false,'message','You can only edit your own unclaimed guest tickets'); END IF;
  IF coalesce(trim(p_name),'') = '' THEN RETURN jsonb_build_object('ok',false,'message','Name is required'); END IF;
  UPDATE public.experience_registrations SET participant_name=trim(p_name),
    participant_email=nullif(lower(trim(p_email)),''), participant_phone=nullif(trim(p_phone),''), updated_at=now()
  WHERE id=p_registration_id;
  RETURN jsonb_build_object('ok',true,'id',p_registration_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_add_manual_seat(uuid,text,text,text,text,text,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_seat(uuid,text,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_cancel_manual_seat(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.participant_update_guest_seat(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_add_manual_seat(uuid,text,text,text,text,text,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_seat(uuid,text,text,text,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_manual_seat(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.participant_update_guest_seat(uuid,text,text,text) TO authenticated, service_role;
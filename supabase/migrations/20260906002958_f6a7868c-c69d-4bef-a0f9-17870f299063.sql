-- Goosepick Accounts & Registrations — Phase 3 (additive only)
-- Shopify webhook foundation: event ledger, additive commerce/registration
-- columns, occurrence keys, lookup indexes, purchaser auto-link and an
-- admin-only RPC to attach an unmapped seat to a session.
--
-- Phase 1 (participant/commerce tables) and Phase 2 (roster assignment RPC)
-- are already live and are NOT touched here. Every statement below is
-- additive and idempotent (IF NOT EXISTS / DROP IF EXISTS + CREATE), so a
-- transaction dry-run followed by a real apply produces the same result.
-- Function bodies use $fn$ tags so the whole file can be wrapped in a
-- DO $dry$ ... $dry$ block for the dry-run.

-- ---------------------------------------------------------------------------
-- 1. commerce_webhook_events — provider event ledger (idempotency + audit)
--    One row per X-Shopify-Webhook-Id. Written only by the Edge Function with
--    the service role; admins may read it to see events that need attention.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.commerce_webhook_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL DEFAULT 'shopify',
  webhook_id text NOT NULL,
  topic text NOT NULL,
  shop_domain text,
  event_id text,
  api_version text,
  triggered_at timestamptz,
  shopify_order_id text,
  payload_hash text NOT NULL,
  raw_payload jsonb,
  status text NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'processed', 'ignored', 'needs_review', 'error')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  attempt_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, webhook_id)
);

CREATE INDEX IF NOT EXISTS commerce_webhook_events_order_idx
  ON public.commerce_webhook_events (shopify_order_id);
CREATE INDEX IF NOT EXISTS commerce_webhook_events_created_idx
  ON public.commerce_webhook_events (created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_webhook_events_attention_idx
  ON public.commerce_webhook_events (created_at DESC)
  WHERE status IN ('needs_review', 'error');

GRANT SELECT ON public.commerce_webhook_events TO authenticated;
GRANT ALL ON public.commerce_webhook_events TO service_role;

ALTER TABLE public.commerce_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view webhook events" ON public.commerce_webhook_events;
CREATE POLICY "Admins can view webhook events"
  ON public.commerce_webhook_events FOR SELECT TO authenticated
  USING (public.is_admin());

DROP TRIGGER IF EXISTS commerce_webhook_events_set_updated_at ON public.commerce_webhook_events;
CREATE TRIGGER commerce_webhook_events_set_updated_at
  BEFORE UPDATE ON public.commerce_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. commerce_orders — additive purchaser / cancellation columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.commerce_orders
  ADD COLUMN IF NOT EXISTS purchaser_name text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS shopify_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_webhook_topic text,
  ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. experience_registrations — additive line-item audit columns
--    (non-PII product/variant identity so an unmapped seat can be attached to
--    the right session later, plus the exact key the storefront sent).
-- ---------------------------------------------------------------------------
ALTER TABLE public.experience_registrations
  ADD COLUMN IF NOT EXISTS shopify_product_id text,
  ADD COLUMN IF NOT EXISTS shopify_variant_id text,
  ADD COLUMN IF NOT EXISTS line_item_title text,
  ADD COLUMN IF NOT EXISTS line_item_quantity integer,
  ADD COLUMN IF NOT EXISTS requested_session_key text,
  ADD COLUMN IF NOT EXISTS unmapped_reason text;

CREATE INDEX IF NOT EXISTS experience_registrations_unmapped_idx
  ON public.experience_registrations (created_at DESC)
  WHERE status = 'unmapped';

-- ---------------------------------------------------------------------------
-- 4. shopify_session_mappings — occurrence key + lookup indexes
--    mapping_key stays the unique per-row identity. occurrence_key is shared
--    by every variant row that points at the same Goosepick session so the
--    storefront only needs ONE stable key per event occurrence.
-- ---------------------------------------------------------------------------
ALTER TABLE public.shopify_session_mappings
  ADD COLUMN IF NOT EXISTS occurrence_key text;

CREATE INDEX IF NOT EXISTS shopify_session_mappings_occurrence_key_idx
  ON public.shopify_session_mappings (occurrence_key)
  WHERE occurrence_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS shopify_session_mappings_product_variant_active_idx
  ON public.shopify_session_mappings (shopify_product_id, shopify_variant_id)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- 5. Purchaser auto-link: when someone creates a participant profile with the
--    same (JWT-verified) email that paid for an order, attach the order and
--    its seats to that profile. Only the purchaser's OWN single seat
--    (participant_email set by the webhook) becomes their participant seat;
--    seats bought for other people stay unclaimed until a later claim flow.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.link_participant_profile_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
    RETURN NEW;
  END IF;

  UPDATE public.commerce_orders
  SET purchaser_profile_id = NEW.id
  WHERE purchaser_profile_id IS NULL
    AND purchaser_email IS NOT NULL
    AND lower(purchaser_email) = lower(NEW.email);

  UPDATE public.experience_registrations r
  SET purchaser_profile_id = NEW.id
  FROM public.commerce_orders o
  WHERE r.commerce_order_id = o.id
    AND r.purchaser_profile_id IS NULL
    AND o.purchaser_profile_id = NEW.id;

  UPDATE public.experience_registrations
  SET profile_id = NEW.id,
      status = CASE
        WHEN status IN ('paid', 'profile_required') THEN 'confirmed'
        ELSE status
      END
  WHERE profile_id IS NULL
    AND participant_email IS NOT NULL
    AND lower(participant_email) = lower(NEW.email)
    AND status IN ('paid', 'profile_required', 'confirmed', 'unmapped');

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.link_participant_profile_on_signup() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.link_participant_profile_on_signup() FROM anon;

DROP TRIGGER IF EXISTS participant_profiles_link_commerce ON public.participant_profiles;
CREATE TRIGGER participant_profiles_link_commerce
  AFTER INSERT ON public.participant_profiles
  FOR EACH ROW EXECUTE FUNCTION public.link_participant_profile_on_signup();

-- ---------------------------------------------------------------------------
-- 6. Shopify id normaliser: mappings and registrations store numeric ids as
--    text; GIDs ("gid://shopify/Product/123") are accepted and reduced.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.shopify_numeric_id(p_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $fn$
  SELECT NULLIF(btrim(regexp_replace(COALESCE(p_id, ''), '^gid://shopify/[A-Za-z]+/', '')), '');
$fn$;

-- ---------------------------------------------------------------------------
-- 7. Admin-only RPC: attach an UNMAPPED seat to a mapping (and its session).
--    Never guesses: the caller picks the mapping, and the product / variant
--    recorded on the seat must agree with the mapping.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_resolve_unmapped_registration(
  p_registration_id uuid,
  p_mapping_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_reg public.experience_registrations%ROWTYPE;
  v_map public.shopify_session_mappings%ROWTYPE;
  v_session_status public.session_status;
  v_new_status text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Admin access required');
  END IF;

  IF p_registration_id IS NULL OR p_mapping_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Registration and mapping are required');
  END IF;

  SELECT * INTO v_reg
  FROM public.experience_registrations
  WHERE id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Registration not found');
  END IF;

  IF v_reg.status <> 'unmapped' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Registration is ' || v_reg.status || ', not unmapped');
  END IF;

  SELECT * INTO v_map FROM public.shopify_session_mappings WHERE id = p_mapping_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mapping not found');
  END IF;
  IF NOT v_map.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mapping is inactive');
  END IF;
  IF v_map.session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mapping is not linked to a session yet');
  END IF;

  SELECT status INTO v_session_status FROM public.sessions WHERE id = v_map.session_id;
  IF v_session_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Session not found');
  END IF;
  IF v_session_status = 'ended' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ended sessions are archived and cannot be modified.');
  END IF;

  IF v_reg.shopify_product_id IS NOT NULL
     AND public.shopify_numeric_id(v_reg.shopify_product_id)
         IS DISTINCT FROM public.shopify_numeric_id(v_map.shopify_product_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mapping is for a different Shopify product');
  END IF;

  IF v_map.shopify_variant_id IS NOT NULL
     AND v_reg.shopify_variant_id IS NOT NULL
     AND public.shopify_numeric_id(v_reg.shopify_variant_id)
         IS DISTINCT FROM public.shopify_numeric_id(v_map.shopify_variant_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Mapping is for a different Shopify variant');
  END IF;

  v_new_status := CASE
    WHEN v_reg.profile_id IS NOT NULL THEN 'confirmed'
    WHEN v_reg.participant_email IS NOT NULL THEN 'profile_required'
    ELSE 'paid'
  END;

  UPDATE public.experience_registrations
  SET mapping_id = v_map.id,
      session_id = v_map.session_id,
      status = v_new_status,
      unmapped_reason = NULL
  WHERE id = p_registration_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_new_status,
    'session_id', v_map.session_id,
    'mapping_id', v_map.id
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_resolve_unmapped_registration(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_resolve_unmapped_registration(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_unmapped_registration(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.shopify_numeric_id(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shopify_numeric_id(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.shopify_numeric_id(text) TO authenticated, service_role;

-- Goosepick Accounts & Registrations — Phase 1 (additive only)
-- STATUS: FOR REVIEW ONLY. Not applied to the database in this turn.
-- Apply later via the platform migration tool, byte-for-byte, once approved.
--
-- This migration is purely additive. It creates the permanent participant
-- identity + commerce/registration layer above the existing roster tables.
-- The ONLY existing table touched is public.players, which is additively
-- altered with two NULLABLE linkage columns (profile_id, registration_id) and
-- their indexes. No existing column, policy, function, trigger or row is
-- modified or removed, so all current roster/admin/rotation/scoring/reset
-- behavior is preserved.

-- ---------------------------------------------------------------------------
-- 0. Reusable updated_at helper (project has none yet)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. participant_profiles — permanent participant identity (PII)
-- ---------------------------------------------------------------------------
CREATE TABLE public.participant_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  preferred_city_id uuid REFERENCES public.cities(id),
  marketing_opt_in boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX participant_profiles_email_lower_key
  ON public.participant_profiles (lower(email));
CREATE UNIQUE INDEX participant_profiles_phone_key
  ON public.participant_profiles (phone)
  WHERE phone IS NOT NULL;

GRANT SELECT, INSERT, UPDATE ON public.participant_profiles TO authenticated;
GRANT ALL ON public.participant_profiles TO service_role;

ALTER TABLE public.participant_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view their own profile"
  ON public.participant_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- A participant may only write a row for their own auth identity AND the
-- stored email must match the verified email in their JWT. This stops a user
-- from claiming someone else's address or poisoning the unique email index.
CREATE POLICY "Participants can create their own profile"
  ON public.participant_profiles FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  );

CREATE POLICY "Participants can update their own profile"
  ON public.participant_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
  );

CREATE TRIGGER participant_profiles_set_updated_at
  BEFORE UPDATE ON public.participant_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper: current authenticated user's participant profile id.
CREATE OR REPLACE FUNCTION public.current_participant_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.participant_profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

-- SECURITY DEFINER functions are executable by PUBLIC by default, and this
-- platform may also hold an explicit anon grant. Revoke from both, then grant
-- explicitly to the roles that legitimately need the helper.
REVOKE ALL ON FUNCTION public.current_participant_profile_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_participant_profile_id() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_participant_profile_id() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. commerce_orders — Shopify paid orders (commerce truth stays in Shopify)
-- ---------------------------------------------------------------------------
CREATE TABLE public.commerce_orders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_order_id text NOT NULL UNIQUE,
  shopify_order_name text,
  purchaser_profile_id uuid REFERENCES public.participant_profiles(id),
  purchaser_email text,
  purchaser_phone text,
  currency text,
  total_amount numeric,
  financial_status text,
  raw_payload jsonb,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX commerce_orders_purchaser_profile_idx
  ON public.commerce_orders (purchaser_profile_id);
CREATE INDEX commerce_orders_purchaser_email_idx
  ON public.commerce_orders (lower(purchaser_email));

-- Read-only for clients; the webhook writes with the service role.
GRANT SELECT ON public.commerce_orders TO authenticated;
GRANT ALL ON public.commerce_orders TO service_role;

ALTER TABLE public.commerce_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Purchasers can view their own orders"
  ON public.commerce_orders FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (
      purchaser_profile_id IS NOT NULL
      AND purchaser_profile_id = public.current_participant_profile_id()
    )
    OR (
      purchaser_email IS NOT NULL
      AND lower(purchaser_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    )
  );

CREATE TRIGGER commerce_orders_set_updated_at
  BEFORE UPDATE ON public.commerce_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. shopify_session_mappings — immutable Shopify -> Goosepick occurrence map
--    Never inferred from product titles or date text.
-- ---------------------------------------------------------------------------
CREATE TABLE public.shopify_session_mappings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  mapping_key text NOT NULL UNIQUE,
  shopify_product_id text NOT NULL,
  shopify_variant_id text,
  city_id uuid REFERENCES public.cities(id),
  event_type public.scope_event_type NOT NULL,
  location_id uuid REFERENCES public.locations(id),
  session_date date NOT NULL,
  session_id uuid REFERENCES public.sessions(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A variant may legitimately map to many occurrence dates, so the only
-- uniqueness beyond mapping_key is per (product, variant, scope, date).
CREATE UNIQUE INDEX shopify_session_mappings_occurrence_key
  ON public.shopify_session_mappings (
    shopify_product_id,
    COALESCE(shopify_variant_id, ''),
    COALESCE(city_id, '00000000-0000-0000-0000-000000000000'::uuid),
    event_type,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    session_date
  );
CREATE INDEX shopify_session_mappings_variant_idx
  ON public.shopify_session_mappings (shopify_variant_id);
CREATE INDEX shopify_session_mappings_session_idx
  ON public.shopify_session_mappings (session_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shopify_session_mappings TO authenticated;
GRANT ALL ON public.shopify_session_mappings TO service_role;

ALTER TABLE public.shopify_session_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view mappings"
  ON public.shopify_session_mappings FOR SELECT TO authenticated
  USING (public.is_admin());
CREATE POLICY "Admins can insert mappings"
  ON public.shopify_session_mappings FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());
CREATE POLICY "Admins can update mappings"
  ON public.shopify_session_mappings FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins can delete mappings"
  ON public.shopify_session_mappings FOR DELETE TO authenticated
  USING (public.is_admin());

CREATE TRIGGER shopify_session_mappings_set_updated_at
  BEFORE UPDATE ON public.shopify_session_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. experience_registrations — one row per paid seat
--    Only source-of-truth states are stored. roster_pending / roster_ready /
--    live / completed are DERIVED from session + player linkage at read time.
-- ---------------------------------------------------------------------------
CREATE TABLE public.experience_registrations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  commerce_order_id uuid REFERENCES public.commerce_orders(id) ON DELETE CASCADE,
  shopify_line_item_id text NOT NULL,
  seat_index integer NOT NULL CHECK (seat_index >= 1),
  mapping_id uuid REFERENCES public.shopify_session_mappings(id),
  session_id uuid REFERENCES public.sessions(id),
  profile_id uuid REFERENCES public.participant_profiles(id),
  purchaser_profile_id uuid REFERENCES public.participant_profiles(id),
  participant_name text,
  participant_email text,
  participant_phone text,
  status text NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'profile_required', 'confirmed', 'cancelled', 'refunded', 'unmapped')),
  claim_token_hash text,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shopify_line_item_id, seat_index)
);

CREATE INDEX experience_registrations_session_idx
  ON public.experience_registrations (session_id);
CREATE INDEX experience_registrations_profile_idx
  ON public.experience_registrations (profile_id);
CREATE INDEX experience_registrations_purchaser_idx
  ON public.experience_registrations (purchaser_profile_id);
CREATE INDEX experience_registrations_status_idx
  ON public.experience_registrations (status);
CREATE INDEX experience_registrations_order_idx
  ON public.experience_registrations (commerce_order_id);

-- Read-only for clients; the webhook and admin tooling write with elevated roles.
GRANT SELECT ON public.experience_registrations TO authenticated;
GRANT ALL ON public.experience_registrations TO service_role;

ALTER TABLE public.experience_registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view their own registrations"
  ON public.experience_registrations FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (profile_id IS NOT NULL AND profile_id = public.current_participant_profile_id())
    OR (purchaser_profile_id IS NOT NULL AND purchaser_profile_id = public.current_participant_profile_id())
  );

CREATE TRIGGER experience_registrations_set_updated_at
  BEFORE UPDATE ON public.experience_registrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. players linkage (nullable, additive)
-- ---------------------------------------------------------------------------
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.participant_profiles(id),
  ADD COLUMN IF NOT EXISTS registration_id uuid REFERENCES public.experience_registrations(id);

CREATE INDEX IF NOT EXISTS players_profile_id_idx ON public.players (profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS players_registration_id_key
  ON public.players (registration_id)
  WHERE registration_id IS NOT NULL;

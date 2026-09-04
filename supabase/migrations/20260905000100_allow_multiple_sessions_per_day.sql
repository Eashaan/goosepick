-- Allow multiple historical session instances for the same city/event/location/date.
-- The partial unique index uq_sessions_live_per_scope remains the invariant that
-- prevents more than one LIVE session for a scope at the same time.
ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_city_id_event_type_location_id_date_key;

CREATE INDEX IF NOT EXISTS idx_sessions_scope_date_created
  ON public.sessions (city_id, event_type, location_id, date DESC, created_at DESC);

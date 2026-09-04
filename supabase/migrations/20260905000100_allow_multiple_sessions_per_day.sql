-- Allow multiple historical session instances for the same city/event/location/date.
-- Historical runs may share a date, but there must be only ONE live session for a
-- city/event/locality scope at a time, including Social where location_id is NULL.

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_city_id_event_type_location_id_date_key;

CREATE INDEX IF NOT EXISTS idx_sessions_scope_date_created
  ON public.sessions (city_id, event_type, location_id, date DESC, created_at DESC);

-- The previous partial unique index used nullable location_id directly. PostgreSQL
-- treats NULL values as distinct in ordinary unique indexes, so it did NOT reliably
-- prevent two simultaneous live Social sessions (location_id = NULL).
DROP INDEX IF EXISTS public.uq_sessions_live_per_scope;

CREATE UNIQUE INDEX uq_sessions_live_per_scope
  ON public.sessions (
    city_id,
    event_type,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'live';

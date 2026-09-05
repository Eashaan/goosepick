-- Allow multiple event sessions in the same city/event/locality on the same date.
-- The previous UNIQUE(city_id, event_type, location_id, date) constraint blocked
-- valid same-day reruns such as multiple Goosepick Thursdays sessions.

ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_city_id_event_type_location_id_date_key;

DROP INDEX IF EXISTS public.uq_sessions_live_per_scope;

-- Keep the real invariant: at most one LIVE session per city/event/locality.
-- COALESCE is required so Social (location_id IS NULL) is protected too.
CREATE UNIQUE INDEX uq_sessions_live_per_scope
  ON public.sessions (
    city_id,
    event_type,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'live';

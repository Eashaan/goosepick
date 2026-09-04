-- Foundation repair: make repeated event runs truly session-isolated.
-- 1) Allow multiple historical sessions on the same date. The existing partial
--    unique index uq_sessions_live_per_scope remains the guard that permits only
--    one LIVE session per city/event/location at a time.
ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_city_id_event_type_location_id_date_key;

CREATE INDEX IF NOT EXISTS idx_sessions_scope_date_created
  ON public.sessions (city_id, event_type, location_id, date DESC, created_at DESC);

-- 2) court_units previously stopped at city/event/location, so locks/configuration
--    leaked between event runs. Attach each unit to the run that created it.
ALTER TABLE public.court_units
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_court_units_session
  ON public.court_units(session_id);

-- Best-effort backfill for the current configuration. Historical rows with no
-- resolvable current session remain NULL and are ignored by session-aware UI.
UPDATE public.court_units cu
SET session_id = sc.session_id
FROM public.session_configs sc
WHERE cu.session_id IS NULL
  AND sc.session_id IS NOT NULL
  AND cu.city_id = sc.city_id
  AND cu.event_type = sc.event_type
  AND cu.location_id IS NOT DISTINCT FROM sc.location_id;

-- Replace legacy scope-only uniqueness with per-session uniqueness.
DROP INDEX IF EXISTS public.court_units_court_scope_idx;
DROP INDEX IF EXISTS public.court_units_group_scope_idx;

CREATE UNIQUE INDEX IF NOT EXISTS court_units_court_session_scope_idx
  ON public.court_units (
    city_id,
    event_type,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(session_id, '00000000-0000-0000-0000-000000000000'::uuid),
    court_number
  )
  WHERE type = 'court';

CREATE UNIQUE INDEX IF NOT EXISTS court_units_group_session_scope_idx
  ON public.court_units (
    city_id,
    event_type,
    COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(session_id, '00000000-0000-0000-0000-000000000000'::uuid),
    display_name
  )
  WHERE type = 'group';

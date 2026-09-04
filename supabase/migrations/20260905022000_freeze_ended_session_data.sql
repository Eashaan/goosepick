-- Ended sessions are historical archives. Prevent any later client, RPC, or
-- edge-function mutation of rows that are explicitly bound to an ended session.

CREATE OR REPLACE FUNCTION public.prevent_ended_session_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_session_id uuid;
  v_new_session_id uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old_session_id := OLD.session_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new_session_id := NEW.session_id;
  END IF;

  -- Protect the old ownership too, so an archived row cannot be made mutable by
  -- reassigning or nulling its session_id.
  IF v_old_session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sessions
    WHERE id = v_old_session_id AND status = 'ended'
  ) THEN
    RAISE EXCEPTION 'Ended sessions are archived and cannot be modified.'
      USING ERRCODE = '55000';
  END IF;

  IF v_new_session_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.sessions
    WHERE id = v_new_session_id AND status = 'ended'
  ) THEN
    RAISE EXCEPTION 'Ended sessions are archived and cannot be modified.'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
  protected_tables text[] := ARRAY[
    'session_configs',
    'court_units',
    'court_groups',
    'court_state',
    'group_court_state',
    'group_physical_courts',
    'players',
    'matches',
    'feedback',
    'match_substitutions',
    'rotation_audit'
  ];
BEGIN
  FOREACH table_name IN ARRAY protected_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS freeze_ended_session_data ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER freeze_ended_session_data BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.prevent_ended_session_mutation()',
      table_name
    );
  END LOOP;
END;
$$;

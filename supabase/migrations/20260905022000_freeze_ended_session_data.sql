-- Ended sessions are historical archives. Prevent any later client, RPC, or
-- edge-function mutation of rows that are explicitly bound to an ended session.

CREATE OR REPLACE FUNCTION public.prevent_ended_session_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_id uuid;
  v_status public.session_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_session_id := OLD.session_id;
  ELSE
    v_session_id := NEW.session_id;
  END IF;

  -- Legacy/unbound rows are left alone. All current-session writes are expected
  -- to carry session_id after Foundation Repair 2.
  IF v_session_id IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT status INTO v_status
  FROM public.sessions
  WHERE id = v_session_id;

  IF v_status = 'ended' THEN
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

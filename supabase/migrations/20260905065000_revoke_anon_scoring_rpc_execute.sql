-- Foundation hardening 3D
-- Supabase may carry explicit EXECUTE grants for the anon role even after
-- revoking PUBLIC. Scoring RPCs are admin-only, so remove anon explicitly.

REVOKE ALL ON FUNCTION public.start_match_atomic(uuid, integer, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.end_match_atomic(uuid, integer, uuid, integer, integer, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.start_group_match_atomic(uuid, uuid, integer, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.end_group_match_atomic(uuid, uuid, integer, uuid, integer, integer) FROM anon;

GRANT EXECUTE ON FUNCTION public.start_match_atomic(uuid, integer, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_match_atomic(uuid, integer, uuid, integer, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_group_match_atomic(uuid, uuid, integer, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_group_match_atomic(uuid, uuid, integer, uuid, integer, integer) TO authenticated;

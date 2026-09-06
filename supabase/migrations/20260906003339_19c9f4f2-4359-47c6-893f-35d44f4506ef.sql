-- Phase 3 follow-up: the platform's default privileges hand new tables to
-- anon/authenticated; strip those so the ledger is service_role-write,
-- admin-read only (RLS remains the primary guard).
REVOKE ALL ON public.commerce_webhook_events FROM anon;
REVOKE ALL ON public.commerce_webhook_events FROM authenticated;
GRANT SELECT ON public.commerce_webhook_events TO authenticated;
GRANT ALL ON public.commerce_webhook_events TO service_role;
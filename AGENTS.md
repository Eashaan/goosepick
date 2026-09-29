# AGENTS

- Staff RBAC: roles owner/admin/host/viewer in user_roles; DB `has_permission()`/`is_admin()` (owner+admin)/`is_event_operator()` (owner/admin/host)/`is_staff()` enforce, `src/lib/rbac.ts` mirrors for UI only — server is the source of truth.
- Admin flow never routes through `/`: `/admin` renders Admin Home when no event context; logout → `/admin/login` — `/` is the participant portal.

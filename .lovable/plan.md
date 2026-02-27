

## Root Cause

`court_groups.session_id` stores a **draft/config-time session ID** (`e5ea791e`), but `useActiveSession` resolves the **live session** (`95a4d6c4`). The validation `data.session_id !== sessionId` fails, returning `null` and showing the "not available" message.

The `session_configs.session_id` and `sessions.id` are two different IDs — the session_config was linked to a different session record than the one that was promoted to live.

## Fix

**`src/pages/public/PublicGroup.tsx`** — Replace direct session_id comparison with a lookup through `session_configs`:

1. Instead of comparing `group.session_id` directly against the live `sessionId`, validate the group by checking that its `session_config_id` belongs to the current scope (city/event/location). The group's `session_config_id` is the stable link.

2. Alternatively (simpler fix): remove the `session_id` mismatch guard entirely. The group is already scoped by its `session_config_id`, and the players/matches/court_states queries already filter by `sessionId`. The guard is redundant and causes this false rejection.

**Concrete change**: Remove lines ~43-46 (the `session_id` mismatch check):
```typescript
// REMOVE:
if (data && sessionId && data.session_id && data.session_id !== sessionId) {
  return null;
}
```

The downstream queries (`group_players`, `group_matches`, `group_court_state`) all filter by `sessionId` already, so no stale data will leak.

## Data Fix (optional)

The underlying data inconsistency — `court_groups.session_id` not matching the live `sessions.id` — should also be investigated. The `startSession` mutation links `session_configs.session_id` but doesn't update `court_groups.session_id`. This could be addressed separately by updating `court_groups.session_id` when a session is started.




## Problem

When a guest player is created via `PlayerSwapModal`, the insert does **not** include `session_id`. However, the players query in `AdminGroup.tsx` (line 117) filters by `session_id`:

```typescript
if (sessionId) query = query.eq("session_id", sessionId);
```

So the newly created guest player is excluded from query results, causing `getPlayerName()` to return "—".

## Fix

### 1. `PlayerSwapModal.tsx` — Accept and use `sessionId`

- Add `sessionId?: string` to the props interface
- Include `session_id` in the guest player insert data (alongside `group_id` or `court_id`)

### 2. `AdminGroup.tsx` — Pass `sessionId` to the modal

- Add `sessionId={sessionId}` prop to the `<PlayerSwapModal>` component (line 884-896)

This ensures the new guest player matches the same `session_id` filter used by the players query, so `getPlayerName()` resolves correctly after the query cache is invalidated.


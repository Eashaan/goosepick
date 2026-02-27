

## Root Cause Analysis

There are **two distinct sync failures** between admin and public:

### Problem 1: Ungrouped courts lack `session_id` scoping
- **AdminCourt** inserts players with only `{ court_id, name }` -- no `session_id`
- Both AdminCourt and PublicCourt query `players/matches/court_state WHERE court_id = X` without any `session_id` filter
- The `generate-rotation` edge function fetches `session_id` from `courts.session_id`, which may be stale or null
- This causes cross-session data leakage or empty results when `court_id` values change between sessions

### Problem 2: Stale `court_groups` with null `session_id` confuse public selector
- Multiple `court_groups` rows exist for the same `court_ids` array but different/null `session_id` values
- PublicCourtSelector matches groups by array comparison and accepts `session_id = null`, so it links to wrong group IDs
- The public group page then shows empty data because the wrong `group_id` has no players/matches

---

## Implementation Plan

### Task 1: Add `session_id` to ungrouped court queries (AdminCourt + PublicCourt)

**AdminCourt.tsx:**
- Use `useActiveSession()` hook (already imported) to get `sessionId`
- Add `session_id` filter to player, match, and court_state queries: `.eq("session_id", sessionId)`
- When inserting players, include `session_id`: `{ court_id: courtNumber, name, session_id: sessionId }`
- Add `session_id` to realtime channel filters
- Guard all queries with `enabled: !!sessionId`

**PublicCourt.tsx:**
- Import and use `useActiveSession()` to get `sessionId`
- Add `.eq("session_id", sessionId)` to player, match, court_state, and court details queries
- Add `session_id` to realtime channel filters
- Guard queries with `enabled: !!sessionId`

### Task 2: Fix `generate-rotation` edge function session scoping

- Accept `sessionId` as input parameter alongside `courtId`
- Use the passed `sessionId` when querying players: `.eq("session_id", sessionId)`
- Use it when inserting matches and court_state
- Delete existing matches scoped to `session_id + court_id`, not just `court_id`
- AdminCourt must pass `sessionId` in the function invoke body

### Task 3: Fix PublicCourtSelector group matching

- In the `courtGroups` query, strictly filter: `.eq("session_id", activeSession.id)` (no fallback to null)
- Remove the `|| cg.session_id === null` fallback in the matching logic
- This ensures only groups from the current session are shown

### Task 4: Fix `reset-ungrouped-court` edge function

- Add `session_id` filter to all delete queries (matches, players, court_state, etc.) so it only deletes data for the active session
- Currently it deletes by `court_id` alone which could affect other sessions

---

### Files to modify:
1. `src/pages/admin/AdminCourt.tsx` -- add session_id to all queries + inserts
2. `src/pages/public/PublicCourt.tsx` -- add session_id to all queries
3. `src/pages/public/PublicCourtSelector.tsx` -- strict session_id filtering on court_groups
4. `supabase/functions/generate-rotation/index.ts` -- accept + use sessionId
5. `supabase/functions/reset-ungrouped-court/index.ts` -- scope deletes by session_id

### No changes to:
- Rotation algorithm logic
- PI/leaderboard math
- Group rotation or group reset logic
- Scoring logic
- Any UI styling


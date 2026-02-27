

## Fix: Scope Dashboard Status Queries to Active Session

The `AdminDashboard` queries for `matches`, `court_states`, and `rotation_audit` currently fetch **all data** for linked court IDs without filtering by session. Old ended-session data makes courts appear active.

### Changes

**`src/pages/admin/AdminDashboard.tsx`**

1. **`courtMatchCounts` query** (~line 90): Add `.eq("session_id", currentSessionId)` filter so only current-session matches are counted. Return empty map if no active session.

2. **`courtStates` query** (~line 78): Add `.eq("session_id", currentSessionId)` filter (court_state has a `session_id` column).

3. **`fairnessScores` query** (~line 100): Add `.eq("session_id", currentSessionId)` filter (rotation_audit has a `session_id` column). Return empty map if no active session.

This ensures cards show "setup" (no dots) when there's no data for the current session, even if old session data exists for the same court.




## Export CSV Improvements

### Problems identified

1. **Player names missing**: Group-based players have `court_id = NULL` and only `group_id` set. The export function fetches players with `.in("court_id", courtIds)`, so group players are never loaded into the `playerMap` — resulting in blank names or raw UUIDs in the CSV.

2. **Flat structure**: All matches and the leaderboard are dumped as one flat list with no separation by court or group.

### Fix: Rewrite `supabase/functions/export-session/index.ts`

**Player fetch fix** — Also fetch players by `session_id` (catches both court-based and group-based players):
```typescript
const { data: players } = await db
  .from("players")
  .select("*")
  .eq("session_id", sessionId);
```

**Fetch court_groups and court_units** for display names:
```typescript
const { data: courtGroups } = await db
  .from("court_groups")
  .select("id, court_ids")
  .eq("session_id", sessionId);

const { data: courtUnits } = await db
  .from("court_units")
  .select("display_name, court_id, court_group_id, type");
```

**Also fetch matches by session_id** (not just court_id) to capture group matches:
```typescript
const { data: matches } = await db
  .from("matches")
  .select("*")
  .eq("session_id", sessionId)
  .order("global_match_index", { ascending: true });
```

**Restructure CSV output** — Organize by court/group:

```text
=== Courts 8 & 9 (Group) ===

-- MATCHES --
Match #, Court #, Team 1 Player 1, ..., Score

-- LEADERBOARD --
Rank, Player, Matches, Wins, Win %, ...

=== Court 7 (Standalone) ===

-- MATCHES --
...

-- LEADERBOARD --
...

=== FEEDBACK ===
...
```

Logic:
1. Identify standalone courts (matches with `group_id = NULL`) and groups (matches with `group_id` set)
2. For each group: get display name from `court_units`, filter matches by `group_id`, compute per-group leaderboard
3. For each standalone court: filter matches by `court_id` where `group_id IS NULL`, compute per-court leaderboard
4. Append feedback section at the end

### File changed
- `supabase/functions/export-session/index.ts` — Full rewrite of data fetching and CSV structure


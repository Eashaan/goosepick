

## Fix: Export CSV — court/group-wise summary with players, matches, and leaderboard

### Problems identified

1. **Missing session filter on `court_units`** — line 138 queries `court_units` without filtering by session, so `groupDisplayMap` and `courtDisplayMap` may be empty or wrong, causing group/court sections to silently skip.

2. **`getClaims` doesn't exist** in supabase-js v2 — should use `getUser()` instead. This may cause the function to throw and return a generic error rather than the CSV.

3. **Players not grouped per section** — all players are dumped in one flat list at the bottom instead of being listed within each court/group section.

### Fix in `supabase/functions/export-session/index.ts`

**Auth fix**: Replace `getClaims` with `getUser()`:
```typescript
const { data: { user }, error: userError } = await userSupabase.auth.getUser();
if (userError || !user) { return 401; }
const userId = user.id;
```

**Filter `court_units` by session's courts/groups**: Join to actual court IDs and group IDs from the session data, or filter by the session's city_id + event_type.

**Restructure `renderSection`** to include 3 sub-sections per court/group:
```text
=== Court Group: Courts 1 & 2 ===

-- PLAYERS (6) --
Player Name
Alice
Bob
...

-- MATCH ROSTER --
Match #, Court #, Team 1 P1, Team 1 P2, Team 2 P1, Team 2 P2, T1 Score, T2 Score, Status
1, 1, Alice, Bob, Carol, Dave, 21, 18, completed
...

-- LEADERBOARD --
Rank, Player, Matches, Wins, Win %, Avg Point Diff, Performance Index
1, Alice, 4, 3, 75.0%, 3.25, 61.75
...
```

**Player grouping**: Build `groupPlayerMap` and `courtPlayerMap` from `players` table using `group_id` and `court_id` columns, then render each section's player list from those maps.

**Feedback** remains as a flat section at the end.

### File changed
- `supabase/functions/export-session/index.ts` — auth fix, session-scoped court_units query, player lists per section


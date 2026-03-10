

## Fix: Court number in PersonalRoster nudge message

### Problem
In `PersonalRoster.tsx` line ~89, the nudge message uses `playerCurrentMatch?.court_number` directly — this is the raw database court ID (e.g., 39), not the logical display number (e.g., 2).

### Fix
The component receives `courtId` and could receive the group's `courtIds` array to apply the same `courtDisplayNumber` mapping. However, looking at the code, the `PersonalRoster` doesn't currently have access to the full list of court IDs in the group.

**Two changes needed:**

1. **`src/pages/public/PublicGroup.tsx`** — Pass the `courtIds` array (from `court_groups.court_ids`) to `PersonalRoster` as a prop.

2. **`src/components/public/PersonalRoster.tsx`**:
   - Add `courtIds?: number[]` to the props interface.
   - In the nudge logic (~line 89), map `playerCurrentMatch.court_number` to a 1-indexed display number using `courtIds.indexOf(cn) + 1`.
   - Fallback: if `courtIds` not provided (standalone court), just show `Court {courtId}`.

### Files changed
- `src/components/public/PersonalRoster.tsx` — accept `courtIds` prop, map court_number to display number in nudge
- `src/pages/public/PublicGroup.tsx` — pass `courtIds` to `PersonalRoster`


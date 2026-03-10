

## Fix: Total Matches showing 0 due to empty `court_ids`

### Problem
The group's `court_ids` array in the database is empty (`[]`), so `N = courtNumbers.length = 0`. The formula `durationHours × matchesPerHour × N` always yields 0 regardless of dropdown selections.

However, the `court_units` table correctly stores `group_court_numbers: [1, 2]` for this group — the court count information exists, it's just not in `court_ids`.

### Fix in `src/pages/admin/AdminGroup.tsx`

Derive `N` from `groupCourtUnit?.group_court_numbers` as a fallback when `court_ids` is empty:

```typescript
// Current (line 106):
const N = courtNumbers.length;

// Fixed:
const N = courtNumbers.length || (groupCourtUnit?.group_court_numbers?.length ?? 0);
```

This ensures the total matches formula works even when `court_ids` is empty, using the court count from `court_units` as a fallback.

### File changed
- `src/pages/admin/AdminGroup.tsx` — line 106, fallback `N` from `group_court_numbers`


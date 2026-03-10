

## Fix: Edge function fails with "Group has no courts assigned"

### Problem
Same root cause as the UI issue — `court_groups.court_ids` is empty in the database. The edge function `generate-group-rotation` reads `group.court_ids` (line 386) and fails at line 389 when it's empty. It needs the same fallback to `court_units.group_court_numbers`.

### Fix in `supabase/functions/generate-group-rotation/index.ts`

After fetching the group (line 380), add a fallback query to `court_units` if `court_ids` is empty:

```typescript
// Line 386-391 — replace with:
let courtNumbers: number[] = group.court_ids || [];

if (courtNumbers.length === 0) {
  // Fallback: fetch from court_units
  const { data: courtUnit } = await supabase
    .from("court_units")
    .select("group_court_numbers")
    .eq("court_group_id", groupId)
    .maybeSingle();

  if (courtUnit?.group_court_numbers) {
    courtNumbers = courtUnit.group_court_numbers;
  }
}

const N = courtNumbers.length;
if (N < 1) {
  return errorResponse("precheck", "Group has no courts assigned");
}
```

### File changed
- `supabase/functions/generate-group-rotation/index.ts` — lines 386-391




## Fix: Live Scoring panels not rendering

### Problem
The scoring panels loop over `courtNumbers` (line 654: `courtNumbers.map(cn => ...)`), which is derived from `group.court_ids` (line 105). Since `court_ids` is empty `[]`, zero panels render. The "Live Scoring" tab appears but shows nothing useful — just the "Rotation locked" message.

This is the same `court_ids` emptiness issue fixed earlier for the label and total matches, but this time affecting the actual scoring UI.

### Fix in `src/pages/admin/AdminGroup.tsx`

**Line 105** — Add fallback to `group_court_numbers`:

```typescript
const courtNumbers: number[] = (group?.court_ids?.length ? group.court_ids : null)
  || groupCourtUnit?.group_court_numbers
  || [];
```

This single change fixes the scoring panels because:
- `courtNumbers.map(cn => ...)` at line 654 will now have actual court numbers to iterate over
- `courtDisplayNumber(cn)` (line 107) will also work correctly since it indexes into the same array
- `N` (line 123) already has the fallback but will also benefit from consistency

### Additional consideration
The `courtDisplayNumber` function (line 107) maps raw court IDs to 1-indexed display numbers. When using `group_court_numbers` (which are already logical numbers like `[1, 2]`), the display function should return the number as-is. Will need to adjust:

```typescript
const courtDisplayNumber = (cn: number): number => {
  const idx = courtNumbers.indexOf(cn);
  return idx >= 0 ? idx + 1 : cn; // fallback to the number itself
};
```

### File changed
- `src/pages/admin/AdminGroup.tsx` — lines 105, 107


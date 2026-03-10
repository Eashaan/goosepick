

## Fix: Admin group header missing court numbers

### Problem
The admin group header shows "Courts " with no numbers. The `groupLabel` is derived from `group?.court_ids` mapped to `[1, 2, ...]`, but if `court_ids` is empty/null in the database row, the array is empty and no numbers render.

The public view already solves this by fetching `court_units.group_court_numbers` as a fallback — the admin view needs the same approach.

### Fix in `src/pages/admin/AdminGroup.tsx`

1. **Add a query** to fetch `court_units.group_court_numbers` for this group (same pattern as `PublicGroup.tsx` lines 172-183).

2. **Update `groupLabel`** to use `group_court_numbers` from `court_units` as the primary source, falling back to the existing `displayNumbers` logic:
   ```typescript
   const groupLabel = useMemo(() => {
     const nums = groupCourtUnit?.group_court_numbers || courtNumbers;
     if (!nums || nums.length === 0) return "Group";
     // For court_units numbers, use directly; for court_ids, use 1-indexed
     const display = groupCourtUnit?.group_court_numbers
       ? nums
       : nums.map((_, i) => i + 1);
     if (display.length === 1) return `Court ${display[0]}`;
     if (display.length === 2) return `Courts ${display[0]} & ${display[1]}`;
     const last = display[display.length - 1];
     const rest = display.slice(0, -1);
     return `Courts ${rest.join(", ")} & ${last}`;
   }, [groupCourtUnit, courtNumbers]);
   ```

### File changed
- `src/pages/admin/AdminGroup.tsx`




## Fix: Display local court numbers (1, 2) instead of database IDs (38, 39)

### Problem
`court_groups.court_ids` stores raw `courts.id` database IDs (e.g., [38, 39]). These are used as `court_number` throughout the data layer (matches, group_court_state). The admin group page displays these raw IDs as court labels ("Courts 38 & 39"), but users expect to see logical local numbers ("Courts 1 & 2").

### Approach
Add a display mapping at the UI level only. The data operations continue using the raw IDs — we only change how numbers appear in labels.

### Changes in `src/pages/admin/AdminGroup.tsx`

1. **Create a display mapping** after `courtNumbers` is defined (~line 105):
   ```typescript
   // Map raw court_id → local 1-indexed display number
   const courtDisplayNumber = (cn: number): number => courtNumbers.indexOf(cn) + 1;
   ```

2. **Update `groupLabel`** (~line 447): Use mapped numbers for the header label:
   ```typescript
   const displayNumbers = courtNumbers.map((_, i) => i + 1);
   const groupLabel = displayNumbers.length <= 2
     ? `Courts ${displayNumbers.join(" & ")}`
     : `Courts ${displayNumbers.slice(0, -1).join(", ")} & ${displayNumbers[displayNumbers.length - 1]}`;
   ```

3. **Update per-court panel title** (~line 643): Change `Court {cn}` to `Court {courtDisplayNumber(cn)}`.

4. **Check all other display references** to `cn` in the scoring panels and apply the same mapping for any user-facing court number text.

### Files changed
- `src/pages/admin/AdminGroup.tsx` — display-only mapping from raw IDs to 1-indexed numbers

### Also check
- `src/pages/public/PublicGroup.tsx` — likely has the same issue for the public-facing group view




## Plan: Direct Link Between `court_units` and `court_groups` (Option C)

### Problem
`PublicCourtSelector` matches group buttons to `court_groups` by comparing sorted court number arrays. But `court_units.group_court_numbers` stores logical numbers (e.g. `[6,7,8]`) while `court_groups.court_ids` stores database `courts.id` values (e.g. `[6,7,33]`). These will never match.

### Solution
Add a `court_group_id` column to `court_units` that directly references the `court_groups.id`. No more array comparison needed.

### Steps

**1. Database migration**: Add `court_group_id uuid` column to `court_units` (nullable, only set for type='group' units).

**2. SetupWizard.tsx** (lines 274-383): After inserting each `court_groups` row, capture the returned `id` and pass it when inserting the corresponding group-type `court_unit` row: `court_group_id: newGroupId`.

**3. PublicCourtSelector.tsx** (lines 25-98): Remove the `courtGroups` query and array-matching logic entirely. Instead, add `court_group_id` to the `RenderItem` type (via `useScopedCourts`), and link group buttons directly: `/public/group/${item.courtGroupId}`. Show "Not ready" only if `courtGroupId` is null.

**4. useScopedCourts.tsx**: Read `court_group_id` from the `court_units` query results. Add it to the `CourtUnit` interface and propagate to `RenderItem` for group-type items.

### Files to modify
1. **Migration**: Add `court_group_id uuid` to `court_units`
2. `src/components/admin/SetupWizard.tsx` — save returned group ID to court_unit
3. `src/hooks/useScopedCourts.tsx` — add `courtGroupId` to types and render items
4. `src/pages/public/PublicCourtSelector.tsx` — use `courtGroupId` directly, remove array matching


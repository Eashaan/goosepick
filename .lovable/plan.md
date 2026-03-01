

## Problem

There are **two separate bugs** causing the public group view to show wrong data:

### Bug 1: Duplicate court_groups created — Admin and Public use different groups

**SetupWizard** creates `court_groups` with `court_ids` set to **database PKs** (e.g., `[33, 34]` for Courts 8 & 9) and links them via `court_units.court_group_id`.

**AdminDashboard.handleGroupClick** searches for groups by matching `court_ids` against `item.courtNumbers` (display numbers like `[8, 9]`). Since `[8, 9] ≠ [33, 34]`, no match is found, so a **new duplicate group** is created with `court_ids = [8, 9]`. The admin enters players/matches into this duplicate, but the public page navigates to the original (empty) group via `court_units.court_group_id`.

### Bug 2: Wrong court label in PublicGroup

`PublicGroup.tsx` builds the header label from `group.court_ids` (database PKs), showing "Courts 33 & 34" instead of "Courts 8 & 9".

---

## Fix

### 1. `AdminDashboard.tsx` — Use `court_units.court_group_id` directly

Change `handleGroupClick` to use `item.courtGroupId` (already available from `court_units`) as the primary group ID, instead of searching by `court_ids` match. If `item.courtGroupId` exists and belongs to the current session, navigate directly to it. Only fall back to creation if no linked group exists.

### 2. `PublicGroup.tsx` — Derive label from `court_units` or `group_court_numbers`

Instead of using `group.court_ids` (database PKs) for the label, fetch the corresponding `court_units` record and use its `group_court_numbers` for the display label. Alternatively, look up court names from the `courts` table.

### 3. Data cleanup consideration

The existing duplicate groups (with display-number court_ids) should ideally be reconciled — either by updating `court_units.court_group_id` to point to the admin-used groups, or by migrating data from duplicates to the original groups. This can be handled by updating the `court_units` records to point to the groups that actually have player/match data.

### Files changed
- **`src/pages/admin/AdminDashboard.tsx`** — Rewrite `handleGroupClick` to prioritize `item.courtGroupId`
- **`src/pages/public/PublicGroup.tsx`** — Fix label derivation; fetch `court_units` for display court numbers


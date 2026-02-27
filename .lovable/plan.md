

## Root Cause

Group players have `court_id = null` in the database (they belong to a `group_id` instead). The `submit-feedback` edge function validates that `player.court_id === court_id`, which always fails for group players since their `court_id` is null.

The FeedbackModal receives `courtId={syntheticCourtId}` (first court_id from the group's `court_ids` array), but the player record has no `court_id` set.

## Fix

### 1. `supabase/functions/submit-feedback/index.ts` — Support group players

Instead of strictly requiring `player.court_id === court_id`, also accept group players by checking if the player belongs to a group that contains the given `court_id`:

- Accept an optional `group_id` parameter
- If `player.court_id` matches `court_id` → pass (ungrouped court)
- If `player.court_id` is null and `group_id` is provided → verify the player's `group_id` matches, and that group contains the `court_id` in its `court_ids` array
- Store feedback with `court_id` as-is (or use group_id for scoping)

### 2. `src/components/public/PersonalRoster.tsx` — Pass group_id to FeedbackModal

Pass the group's ID to FeedbackModal so it can be forwarded to the edge function.

### 3. `src/components/public/FeedbackModal.tsx` — Accept optional groupId prop

Add optional `groupId` prop and include it in the edge function request body.


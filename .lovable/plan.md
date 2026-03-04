

## Why the Export CSV button appears inconsistently

### Root cause

After you end a session, the `useActiveSession` hook re-fetches and follows this priority chain:

1. Find a **live** session → none (just ended it)
2. Find the latest **draft** session → **if one exists, it returns this instead**
3. Find the latest **ended** session → only reached if no draft exists

You currently have a lingering draft session (`Goosepick Social Mumbai - Feb 27, 2026`) in the database. So after ending the live session, the hook picks up this old draft as the "active session." Since the active session is now a draft, `isEnded` is `false`, and the Export CSV button does not render.

When no draft session happens to exist, step 3 kicks in, the ended session is returned, `isEnded` is `true`, and the Export button appears correctly.

### Fix

Update `useActiveSession` query logic so that after ending a session, the just-ended session remains the active one (at least until a new session is started or the admin navigates away).

**Approach**: After the live → ended transition, prioritize the **latest ended session over older drafts**. Change the fallback order to:

1. Live session (highest priority)
2. Latest ended session (so Export is available)
3. Latest draft session (lowest priority)

This is a one-line swap in `useActiveSession.tsx` — move the "ended" query block (lines 72-88) before the "draft" query block (lines 56-70).

### Files changed
- **`src/hooks/useActiveSession.tsx`** — Swap the draft/ended fallback order so ended sessions take priority over old drafts




## Problem

The recent fix to prioritize ended sessions over drafts (so the Export CSV button always appears) introduced a side effect: the **Start Session** button disappears after ending a session.

The button renders only when `!activeSession || isDraft`. Since the hook now returns the ended session, `isDraft` is `false` and `activeSession` exists, so the button is hidden. There is no way to start a fresh session.

## Fix

Update `SessionLifecycleControls.tsx` to also show the "Start Session" button when the current session is **ended**. When clicked in the ended state, `startSession` already handles creating a brand-new live session (it only promotes drafts if the active session is a draft; otherwise it inserts a new row). So the only change needed is the render condition.

### File: `src/components/admin/SessionLifecycleControls.tsx`

Change the Start Session button condition from:

```tsx
{(!activeSession || isDraft) && setupCompleted && (
```

to:

```tsx
{(!activeSession || isDraft || isEnded) && setupCompleted && (
```

This way after ending a session, the admin sees: **Ended** badge + **Start Session** + **Reset** + **Export CSV** — all four controls available simultaneously.

### Files changed
- `src/components/admin/SessionLifecycleControls.tsx` — Add `isEnded` to the Start Session button render condition


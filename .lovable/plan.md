

## Fix: Start Session after End on same day

**Problem**: Clicking "Start Session" after ending a session on the same day fails with a unique constraint violation because the code tries to INSERT a new row instead of reusing the existing one.

**Fix**: In `src/hooks/useActiveSession.tsx`, add a branch in the `startSession` mutation to handle ended sessions — UPDATE the existing row back to `live` status instead of inserting a new one.

### Change in `src/hooks/useActiveSession.tsx`

After the existing draft promotion block (~line 132), add an ended-session promotion block before the "Create new" insert:

```typescript
if (activeSession?.status === "ended") {
  const { error } = await supabase
    .from("sessions")
    .update({
      status: "live",
      started_at: new Date().toISOString(),
      ended_at: null,
      is_active: true,
      session_label: buildLabel(),
    })
    .eq("id", activeSession.id);
  if (error) throw error;
  return activeSession.id;
}
```

This reuses the existing session row, avoiding the unique constraint violation. One session per day per scope is preserved.


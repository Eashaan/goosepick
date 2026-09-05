# Goosepick deployment checklist

The Goosepick app has three independently deployed surfaces:

1. Frontend / Lovable publish
2. Supabase database migrations
3. Supabase Edge Functions

A GitHub merge does **not** by itself prove that the database schema or deployed Edge Functions match the repository. Treat deployment as incomplete until all three are verified.

## Before merging to `main`

- CI build passes.
- CI tests pass.
- Any new migration is reviewed for backwards compatibility and session scoping.
- Any changed Edge Function is identified explicitly in the PR description.
- Preview smoke test passes for the affected flow.

## After merging

### Database

Apply every new migration in `supabase/migrations/` that is not yet present in the connected Supabase project.

Verify important constraints/RPCs directly in the database where relevant. For session lifecycle work, specifically check:

- same-day sessions are allowed;
- only one live session exists per city/event/locality scope;
- court state is keyed by session + court;
- standalone and group scoring RPC signatures include `session_id`.

### Edge Functions

Redeploy every function changed by the merge. Do not assume source sync means runtime sync.

For the current architecture the critical functions include:

- `generate-rotation`
- `generate-group-rotation`
- `reset-ungrouped-court`
- `reset-group`
- `reset-session`
- `submit-feedback`
- `export-session`

After redeploying, inspect the function logs or invoke a safe validation path to confirm the new version is actually running.

### Frontend

Publish the Lovable project only after database migrations and required Edge Functions are current.

## Production smoke test

Run at least one small test in each affected event scope:

- create/configure a session;
- generate a rotation;
- start/end one match;
- open the participant/public view;
- reset the relevant court/group/session;
- end the session;
- create a new session in the same scope;
- verify no old players, matches, groups, locks, or browser state leak into the new run.

For Goosepick Thursdays, repeat the new-session check for a locality because locality is part of the session identity.

## Rollback

Before major foundation changes, create a checkpoint branch from the known-good `main` commit. The checkpoint created before Foundation Hardening 3 is:

`checkpoint/pre-foundation-3-2026-09-05`

Do not delete historical session data as part of rollback. Ended sessions are archives and must remain immutable.

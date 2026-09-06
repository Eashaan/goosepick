# Goosepick roadmap

## Accounts & Registrations — Phase 1 (foundation live)
- [x] Additive schema authored and applied (`db/phase1_participant_accounts.sql`). New tables only, plus two nullable link columns added to existing `players` (no existing roster behavior mutated)
- [x] Review fixes: PKCE callback exchanges `code`; profile INSERT/UPDATE RLS bound to JWT email + `auth.uid()`; `current_participant_profile_id()` revoked from PUBLIC and anon
- [x] Participant passwordless sign-in (`/auth`, `/auth/callback`)
- [x] Participant auth + profile context (never assumes admin)
- [x] Protected `/my` dashboard with Upcoming / Past + empty state
- [x] `/my/profile` first-time profile completion
- [x] Generated Supabase types include the Phase 1 tables and nullable player linkage
- [x] Regression guards for legacy + new routes and migration SQL invariants
- [ ] Configure production auth redirect URLs (Site URL + `/auth/callback`) in platform settings

## Accounts & Registrations — Phase 2 (implementation branch)
- [x] Session-scoped admin registration pool
- [x] Registration assignment targets existing initialized courts/groups and existing `players` rows
- [x] Direct protected `/my/experience/:registrationId` participant route
- [x] Shared `PersonalRoster` supports locked authenticated player identity while preserving legacy `/public` localStorage selection
- [x] Historical participant experience reads use the registration's session rather than the currently active session
- [x] Atomic assignment + later profile-sync SQL authored for review (`db/phase2_registration_assignment.sql`)
- [ ] Review/apply Phase 2 assignment SQL
- [ ] Validate branch CI and merge only after review
- [ ] Publish participant/admin UI only after end-to-end QA

## Commerce automation — next
- [ ] Shopify `orders/paid` webhook (HMAC verification + idempotency)
- [ ] Cancellation/refund synchronization
- [ ] Populate immutable Shopify occurrence mappings and registration seats
- [ ] First-time purchaser/guest claim email flow

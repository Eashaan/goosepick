# Goosepick roadmap

## Accounts & Registrations — Phase 1 (done)
- [x] Additive schema SQL (`db/phase1_participant_accounts.sql`) — APPLIED to the live database by the owner (RLS verified). Do not reapply.
- [x] Review fixes: PKCE callback exchanges `code`; profile INSERT/UPDATE RLS bound to JWT email + `auth.uid()`; `current_participant_profile_id()` revoked from PUBLIC and anon
- [x] Participant passwordless sign-in (`/auth`, `/auth/callback`)
- [x] Participant auth + profile context (never assumes admin)
- [x] Protected `/my` dashboard with Upcoming / Past + empty state
- [x] `/my/profile` first-time profile completion
- [x] Regression guards for legacy + new routes and migration SQL invariants
- [x] Generated database types now include the Phase 1 tables; `participantDb` is the typed client
- [ ] Configure auth redirect URLs (Site URL + `/auth/callback`) in platform settings

## Phase 2 — registrations meet the roster (in progress)
- [x] Admin registration pool inside the existing Players card on court + group admin pages (session-scoped, unlinked paid/profile_required/confirmed seats)
- [x] Assign a registration into the EXISTING `players` row model (`profile_id` + `registration_id`), duplicate/race-safe, ended-session guarded
- [x] Dashboard registration summary (paid / on rosters / waiting)
- [x] `/my/experience/:registrationId` — status-aware page, or the existing roster components with the linked player pre-identified (no court/name selection)
- [x] MyGoosepick cards link to the experience page
- [x] Review-only SQL: `db/phase2_registration_assignment.sql` (atomic assignment RPC + registration→player profile sync trigger) — NOT applied
- [ ] Owner review/apply of `db/phase2_registration_assignment.sql` (client already prefers the RPC and falls back to the guarded direct insert until it exists)

## Phase 3 (not started)
- [ ] Shopify `orders/paid` + cancel/refund webhook function (HMAC, idempotent)
- [ ] Guest seat claim flow (claim token email, purchaser-managed seats)
- [ ] Admin Shopify mapping management UI

# Goosepick roadmap

## Accounts & Registrations — Phase 1 (in progress)
- [x] Additive schema SQL authored for review (`db/phase1_participant_accounts.sql`) — NOT applied. New tables only, plus two nullable link columns added to existing `players` (no existing data/behavior mutated)
- [x] Review fixes: PKCE callback exchanges `code`; profile INSERT/UPDATE RLS bound to JWT email + `auth.uid()`; `current_participant_profile_id()` revoked from PUBLIC
- [x] Participant passwordless sign-in (`/auth`, `/auth/callback`)
- [x] Participant auth + profile context (never assumes admin)
- [x] Protected `/my` dashboard with Upcoming / Past + empty state
- [x] `/my/profile` first-time profile completion
- [x] Regression guards for legacy + new routes and migration SQL invariants
- [ ] Apply the migration after user review (platform migration tool)
- [ ] Configure auth redirect URLs (Site URL + `/auth/callback`) in platform settings

## Phase 2 (not started)
- [ ] Shopify `orders/paid` + cancel/refund webhook function (HMAC, idempotent)
- [ ] Admin registration pool + assignment into existing `players`
- [ ] Direct personal roster from a registration (no court/name selection)

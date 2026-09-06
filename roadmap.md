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
- [x] Participant deep links (`/my/experience/:id`) survive first-time profile completion
- [x] Tests: legacy `/public` selection unchanged, assignment writes into `players` with duplicate guard, RLS-scoped registration reads, linked registration bypasses selectors, admin pool UI (55 passing); build + typecheck green
- [ ] Owner review/apply of `db/phase2_registration_assignment.sql` (client already prefers the RPC and falls back to the guarded direct insert until it exists)
- [ ] Live check of the admin pool with real Shopify registrations once Phase 3 webhook lands (no test rows were seeded in production)

## Phase 3 — Shopify backend + admin mapping foundation (in progress)
- [ ] `db/phase3_shopify_webhook_foundation.sql` — webhook event ledger, additive order/registration columns, occurrence key, mapping lookup indexes, admin resolve RPC (dry-run in BEGIN/ROLLBACK, then apply)
- [ ] Edge Function `shopify-order-webhook` — fail-closed HMAC (SHOPIFY_WEBHOOK_SECRET), shop-domain allowlist, X-Shopify-Webhook-Id idempotency, orders/paid + orders/cancelled + refunds/create
- [ ] Strict occurrence resolution: explicit `goosepick_session_key` line-item property → mapping; explicit date fallback only when exactly one active mapping; otherwise `unmapped` (never guessed)
- [ ] Admin Shopify mapping panel on the dashboard (session ↔ product/variant, stable occurrence key, unmapped seat count + attach, webhook events needing review)
- [ ] `docs/SHOPIFY_EXPERIENCE_INTEGRATION.md` — store-facing contract
- [ ] Tests: HMAC vectors, duplicate idempotency, non-event ignored, exact key success, missing/invalid key → unmapped, N seats once, multi-ticket purchaser not all participants, full cancel, conservative partial refund
- [ ] Owner: create Goosepick Shopify app + webhook subscription, set `SHOPIFY_WEBHOOK_SECRET` (blocked on app secret — not done in this phase)
- [ ] Guest seat claim flow (claim token email, purchaser-managed seats) — later phase

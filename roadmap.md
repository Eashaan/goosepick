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

## Recurring occurrence selection (backend/admin half) — done
- Public read-only Edge Function `shopify-experience-occurrences` (deployed, verify_jwt=false).
- Admin-only draft-only RPC `admin_set_shopify_session_date` (applied live).
- Event date control in ShopifyMappingPanel; mappings inherit `session.date`.
- Remaining: Shopify theme/product-page date picker (separate turn).

## Schedule management (Thursdays automatic + Social manual) — done in app
- Applied migration: `recurring_experience_schedules`, `recurring_experience_exceptions`,
  `sessions.capacity`, `sessions.recurring_schedule_id`, helpers (`session_booked_seats`,
  `session_has_operational_data`) and admin RPCs (reconcile, pause/resume, skip/unskip,
  capacity, create Social). Internal reconciler is service-role only.
- Daily pg_cron job `reconcile-recurring-experience-schedules` at 20:00 UTC keeps a rolling
  8-week window of DRAFT Thursdays sessions + exact Shopify variant mappings per locality.
  Existing 17 Sep Bandra/Andheri sessions and occurrence keys were adopted, not replaced.
- Seeded schedules: Bandra `f0cb217e-a257-41d8-94dd-0ae9f5527401`,
  Andheri `cb3a9c35-6b3e-47ce-973b-9aa0a8ca02cc`.
- Admin UI `/admin/schedule` (linked from the dashboard): schedules with pause/resume and
  skipped dates, upcoming dates grouped by day with on-sale + capacity state, Open (pins the
  exact session for the event-day flow), Skip/Undo skip, capacity editing, manual Social
  creation per city/date with ticket-type selection.
- `useActiveSession` now resolves the nearest UPCOMING draft (pinned session still wins), and
  Start Session asks for confirmation when the session date is in the future.
- Public occurrence feed exposes `capacity`, `remaining`, `sold_out` (counts only, no PII).
- Paid webhook seats are never rejected: an over-capacity date is flagged `needs_review` with
  `capacity_overruns` in the event result.
- Remaining: Shopify theme should hide/block occurrences where `sold_out` is true (theme turn).

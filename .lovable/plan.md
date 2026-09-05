# Goosepick Accounts & Registrations — Additive Plan

## Goal
Add a permanent participant identity and ticket-registration layer on top of the existing app, so a paid Shopify ticket becomes an account-linked registration that lands the participant straight into their own roster. Nothing in the current roster, group, rotation, scoring, reset, admin or realtime behavior changes until an explicit cutover.

Target journey: paid ticket -> registration created -> passwordless sign-in -> My Goosepick -> active experience -> when roster is published, personal roster opens directly (no court/name picking) -> live roster and leaderboard -> past results.

---

## 1. New data (additive only)

New tables, none of which existing code reads:

- **participant_profiles** — one row per signed-in person: linked auth user, first/last name, phone, city preference, marketing opt-in, timestamps. Unique on the auth user; unique normalized email; unique normalized phone (nullable).
- **commerce_orders** — one row per Shopify order: shopify order id (unique), order number, email, phone, currency, total, financial status, raw payload snapshot, processed timestamp. Idempotency lives here.
- **experience_registrations** — one row per seat: order reference, order line item id, `seat_index` (1..quantity), target session, resolved participant profile (nullable until claimed), state, claim token, cancellation/refund fields. Unique on (order line item id, seat_index) so replayed webhooks cannot duplicate seats. Multi-ticket works from day one at the data level even though the guest-claiming UI comes later.
- **shopify_session_mappings** — maps immutable Shopify identifiers (product id, variant id, and optionally selling-plan/date-option id) to a Goosepick city/event/locality/date scope, and optionally to a concrete session id. No title or date text parsing anywhere.
- **players** gains nullable `profile_id` and `registration_id`. Both nullable, no behavior change; rotation, scoring and export keep working on the existing columns.

Indexes on: registrations by session, by profile, by state; orders by shopify id; mappings by variant id.

## 2. Registration state model

`pending_payment -> paid -> profile_required -> confirmed -> roster_pending -> roster_ready -> live -> completed`, plus terminal `cancelled` and `refunded`.

- `paid` set by the webhook.
- `profile_required` while no participant profile is linked.
- `confirmed` once a profile is linked and the session scope is resolved.
- `roster_pending` / `roster_ready` derived from whether the session has a published roster and a linked player row.
- `live` / `completed` follow the existing session status.
- `cancelled` / `refunded` from Shopify cancellation/refund webhooks; these release the seat but never delete history.

Derived states (`roster_pending`, `roster_ready`, `live`, `completed`) are computed from session + player linkage rather than stored redundantly, so they can never drift from the operational tables.

## 3. Access rules (RLS)

- Profiles, orders and registrations: readable and writable only by the owning signed-in participant; admins can read all; the webhook writes with the service role.
- Phone and email live only on profiles and orders — never on `players`, so the existing public roster reads expose no contact details. This is preserved explicitly.
- Existing public tables keep their current public read access. Nothing is tightened in this phase.

## 4. Passwordless participant sign-in

Magic-link / email OTP for participants, added alongside the current email+password admin login. Admin auth, `user_roles` and `has_role`/`is_admin` are untouched; a participant is simply an authenticated user with no admin role. A shared auth listener keeps both flows on one session without changing `useAdminAuth`.

## 5. New pages

- `/auth` — enter email, receive magic link.
- `/auth/callback` — completes sign-in, then routes to profile completion or `/my`.
- `/my/profile` — first-time profile completion (name, phone) when required.
- `/my` — My Goosepick: active experience card with state-aware messaging, plus past experiences.
- `/my/experience/:registrationId` — direct personal roster / live roster / leaderboard for that registration, reusing the existing roster and leaderboard components with the player resolved from the registration instead of a dropdown.

The current `/public` court selector and name dropdown stay exactly as they are for legacy and non-authenticated participants.

## 6. Admin registration pool

A registrations panel on the session admin view lists paid registrations for that session and offers one-click "add to roster", which creates the same `players` row the admin already creates today and stamps the new nullable link columns. Rotation, scoring, substitutions, reset and export logic are not modified. Admins can still add walk-ins and guests manually.

## 7. Shopify webhook function

A single `shopify-webhook` edge function handling `orders/paid`, `orders/cancelled` and `refunds/create`:

- HMAC signature verification against a stored Shopify webhook secret before any parsing; reject otherwise.
- Idempotent: insert the order keyed on the Shopify order id; a replay is a no-op.
- Seat expansion: one registration per line item unit using `seat_index`.
- Session resolution strictly via `shopify_session_mappings` on immutable product/variant identifiers plus a hidden line-item property carrying the mapping key. Unmapped orders are stored and flagged for admin resolution rather than guessed.
- Cancellations and refunds move the affected registrations to their terminal state and release seats.
- Always returns HTTP 200 with a JSON result so Shopify does not retry storms.

Requires one new secret for the Shopify webhook signing key (added in Project Settings -> Secrets).

## 8. Deployment sequencing

1. Schema migration (new tables, nullable link columns, access rules) — inert for existing code.
2. Seed `shopify_session_mappings` for upcoming experiences.
3. Deploy the webhook function; point Shopify at it and verify with a test order.
4. Ship participant auth + `/my` pages behind the existing routes; `/public` untouched.
5. Enable the admin registrations panel.
6. Cutover of participant entry links only after a full live rehearsal.

## 9. Tests and acceptance

- Webhook: valid signature accepted, invalid rejected, replayed order creates no duplicate seats, quantity 3 creates seats 1-3, unmapped variant is flagged not guessed.
- Access: a participant cannot read another participant's profile, order or registration; public roster reads return no email/phone.
- Flow: magic link sign-in -> profile completion -> `/my` shows the active experience -> after roster publication the personal roster opens without any court/name selection.
- Regression: existing foundation tests, build and the current `/public` and admin flows all still pass unchanged.

---

## Project-specific risks to flag

1. **Ended sessions are frozen.** A trigger blocks all writes to session-scoped tables once a session is `ended`. Linking registrations to `players` must therefore happen while the session is draft or live; the plan keeps registration tables out of that trigger's scope so historical results stay readable and immutable.
2. **`players` is currently world-writable.** Existing rules allow anyone to insert/update/delete players. That is pre-existing and out of scope here, but once registrations drive rosters it should be tightened — I'd do that as a separate, explicitly-approved step to avoid breaking today's flows.
3. **Duplicate court groups exist in production.** Earlier repairs left some groups linked through `court_units`. Registration-to-roster assignment will resolve the group the same way the admin UI does today rather than assuming `court_ids` is populated.
4. **One session per day per scope.** Session identity is city + event + locality + date, and Start Session reuses an ended row. Shopify mappings must therefore resolve to that scope, not to a hardcoded session id, with an optional direct session override.
5. **Shopify must send a hidden immutable key.** The storefront needs a hidden line-item property (or a dedicated variant per date) so the webhook can resolve the session without text inference. If that cannot be added in Shopify, orders will land in an admin resolution queue instead.

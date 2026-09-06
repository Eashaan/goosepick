# Shopify ↔ Goosepick Experiences — integration contract

Status: **Phase 3 foundation shipped.** The receiver is deployed and fails closed.
The only remaining manual step is the Shopify app / webhook authorisation at the
end of this document.

Store: `goosepick.com` (permanent domain `j9j1xd-26.myshopify.com`), Basic plan,
INR, IST.

---

## 1. Event products and variants (identity = ids, never titles)

| Product | Product id | Variant | Variant id |
| --- | --- | --- | --- |
| Goosepick Social | `8555007901886` (`gid://shopify/Product/8555007901886`) | Early Bird | `48209652089022` |
| | | General | `45309100523710` |
| Goosepick Thursdays | `8915933724862` (`gid://shopify/Product/8915933724862`) | Bandra / Beginner | `48787061932222` |
| | | Bandra / Beginner+ (<3.0) | `48697902366910` |
| | | Bandra / Intermediate (<3.4) | `48787061964990` |
| | | Bandra / Intermediate+ (<3.8) | `48697913802942` |
| | | Bandra / Advanced (>3.8) | `48697913835710` |
| | | Andheri / Beginner | `48787061997758` |
| | | Andheri / Beginner+ (<3.0) | `48697913868478` |
| | | Andheri / Intermediate (<3.4) | `48787062030526` |
| | | Andheri / Intermediate+ (<3.8) | `48697913901246` |
| | | Andheri / Advanced (>3.8) | `48697913934014` |

Source of truth in code: `supabase/functions/_shared/shopify-catalog.ts`
(shared by the webhook and the admin UI). Ids are stored as numeric strings;
GIDs are accepted anywhere and normalised.

**Variants do not encode a date.** A session is never inferred from a product
or variant title. The only link between a Shopify line item and a Goosepick
session is a row in `shopify_session_mappings` plus the key the storefront
sends (next section).

---

## 2. Occurrence mappings and the session key

Admins link a Goosepick session to Shopify variants from the **Admin Dashboard →
Shopify tickets** card. Linking creates one `shopify_session_mappings` row per
variant. All rows for the same session share one **occurrence key**:

```
occurrence_key : gp_<first 8 hex of session uuid>_<6 random>     e.g. gp_3f9a1c2e_k7m2pq
mapping_key    : <occurrence_key>_v<last 6 of variant id>         e.g. gp_3f9a1c2e_k7m2pq_v089022
                 <occurrence_key>_all   (product-level link, any variant)
```

- Keys are opaque and stable. Regenerating never happens; the key is reused
  for every variant added to the session later.
- Social: Early Bird and General both map to the same Social session (two rows,
  one occurrence key).
- Thursdays: each venue/skill variant is its own row; link only the variants
  for the session's venue. Several variants → same session is expected.
- A variant may map to many dates (one row per session); the unique constraint
  is `(product, variant, city, event_type, location, session_date)`.
- Turning a link **off** (`is_active = false`) stops new tickets resolving to
  it; deleting is blocked once seats reference it.

### Required storefront line item property

Every event ticket line item must carry the occurrence key as a line item
property. Preferred (hidden from the customer because of the leading
underscore):

```
_goosepick_session_key = <occurrence_key>
```

Also accepted: `goosepick_session_key`. As a fallback the same names are read
from order **note attributes** (cart attributes) and applied to every event
line item in that order.

Example add-to-cart form field (Liquid / theme):

```html
<input type="hidden" name="properties[_goosepick_session_key]" value="gp_3f9a1c2e_k7m2pq">
```

Example AJAX add:

```js
fetch('/cart/add.js', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    items: [{ id: 48209652089022, quantity: 2,
              properties: { _goosepick_session_key: 'gp_3f9a1c2e_k7m2pq' } }],
  }),
});
```

The theme has **not** been modified in this phase. The product page decides
which occurrence it is currently selling; the simplest approach is a product
metafield holding the current occurrence key that the theme copies into the
hidden property.

### Optional strict date fallback

If no key is present but the line item (or order) carries
`_goosepick_session_date` / `goosepick_session_date` as `YYYY-MM-DD`, the
webhook resolves **only** when exactly one active mapping exists for that
product+variant on that date. Anything else is unmapped.

### Resolution rules (never a guess)

| Situation | Result |
| --- | --- |
| Key matches an active row for this product (+ variant or product-level) | mapped → `session_id` set |
| Key valid but unknown / inactive | `unmapped` (`key_unknown`) |
| Key belongs to a different product or variant | `unmapped` (`key_product_mismatch`) |
| Key matches more than one row | `unmapped` (`key_ambiguous`) |
| No key, valid date, exactly one active row | mapped |
| No key, no date | `unmapped` (`no_session_key`) — even if only one mapping exists |
| Mapping exists but has no session yet | `unmapped` (`mapping_has_no_session`) |

Exact-variant rows win over product-level rows when both match.

Unmapped seats are never dropped. They appear as a red banner + "Paid seats
waiting for a session" list on the admin dashboard, with product/variant, order
name, purchaser email and the key that was sent. **Attach to this session**
calls the admin-only RPC `admin_resolve_unmapped_registration(registration, mapping)`
which verifies product/variant agreement and refuses ended sessions.

---

## 3. Webhook receiver

Function: `shopify-order-webhook`
URL: `https://<project-ref>.supabase.co/functions/v1/shopify-order-webhook`
(project ref is shown in the Lovable Cloud backend view; the function is
deployed with `verify_jwt = false` — Shopify cannot send a Supabase JWT).

### Topics (one endpoint, branches on `X-Shopify-Topic`)

| Topic | Effect |
| --- | --- |
| `orders/paid` | upsert `commerce_orders`; create one `experience_registrations` row per seat |
| `orders/cancelled` | mark order cancelled; every non-refunded seat → `cancelled` |
| `refunds/create` | refund seats per refunded line item quantity (conservative, see §5) |

Any other topic is recorded as `ignored`.

### Headers that are verified

| Header | Rule |
| --- | --- |
| `X-Shopify-Hmac-Sha256` | base64(HMAC-SHA256(raw body, `SHOPIFY_WEBHOOK_SECRET`)); constant-time compare; missing/invalid → **401** |
| `X-Shopify-Shop-Domain` | must be on the allowlist (`SHOPIFY_ALLOWED_SHOP_DOMAINS`, default `j9j1xd-26.myshopify.com,goosepick.com`) → otherwise **401** |
| `X-Shopify-Topic`, `X-Shopify-Webhook-Id` | required → otherwise **400** |
| `X-Shopify-Event-Id`, `X-Shopify-Api-Version`, `X-Shopify-Triggered-At` | stored on the ledger row |

If `SHOPIFY_WEBHOOK_SECRET` is not set the function returns **503** for every
request (fail closed) and logs `not_configured`.

### Idempotency

`X-Shopify-Webhook-Id` is the idempotency key. Every delivery is written to
`commerce_webhook_events` (`UNIQUE (provider, webhook_id)`) before processing:

- second delivery of a finished event → **200** `{status: "duplicate"}`, nothing re-run
- delivery while the first is still processing → **503** (Shopify retries)
- a previous attempt that errored (or a stale `processing` row > 5 min) is retried

All writes are themselves idempotent (`ON CONFLICT DO NOTHING` on
`(shopify_line_item_id, seat_index)`, upsert on `shopify_order_id`), so replays
with a *new* webhook id also never duplicate seats. Delivery order does not
matter: a cancellation that arrives before the paid event makes the later
`orders/paid` create the seats already cancelled; a stale `paid` never
downgrades `refunded`.

### Response codes

| Code | Meaning |
| --- | --- |
| 200 | processed / ignored / needs_review / duplicate |
| 400 | missing Shopify headers, invalid JSON |
| 401 | HMAC or shop-domain rejected |
| 405 | non-POST (GET returns a deployment probe with no config details) |
| 500 / 503 | retriable — Shopify will redeliver |

Logs are structured JSON (`fn`, `webhook_id`, `topic`, `outcome`, counts).
No emails, names, payloads or secrets are logged.

---

## 4. What `orders/paid` writes

Non-event line items are ignored; an order with no event line items writes
nothing (ledger: `ignored`).

`commerce_orders` (one per Shopify order): `shopify_order_id`, `shopify_order_name`,
purchaser email / phone / name, `currency`, `total_amount`, `financial_status`,
`cancelled_at`, `cancel_reason`, `shopify_created_at`, `raw_payload`,
`purchaser_profile_id` (when a participant profile with the purchaser's email
already exists), `last_webhook_topic/at`.

`experience_registrations` (one per seat = line item × quantity, `seat_index`
1..N):

| Column | Value |
| --- | --- |
| `shopify_line_item_id`, `seat_index` | identity (unique) |
| `mapping_id`, `session_id` | from resolution, or NULL when unmapped |
| `shopify_product_id`, `shopify_variant_id`, `line_item_title`, `line_item_quantity` | audit, non-PII |
| `requested_session_key`, `unmapped_reason` | exactly what the storefront sent / why it failed |
| `purchaser_profile_id` | purchaser's profile on **every** seat (they own the booking) |
| `profile_id`, `participant_name/email/phone` | **only** when the whole order is a single event seat — then it is unambiguously the purchaser's own seat |
| `status` | see below |

### Multi-ticket semantics

- Order total of **1** event seat → it is the purchaser's seat:
  `confirmed` if a profile with that email exists, else `profile_required`
  with the purchaser's contact captured for a later claim.
- Order total of **2+** event seats (any mix of line items) → every seat is
  `paid` with `profile_id = NULL`. The purchaser is *not* assumed to be a
  participant. Seats are claimed/assigned later (guest claim flow is a later
  phase; admin roster assignment already works today).
- Roster players are **never** created by the webhook. Admins add seats to
  courts/groups from the Players card (Phase 2).

### Status meaning

| status | meaning |
| --- | --- |
| `paid` | seat paid, participant identity unknown |
| `profile_required` | participant known by email, no Goosepick account yet |
| `confirmed` | seat linked to a participant profile |
| `unmapped` | occurrence could not be resolved (visible to admins) |
| `cancelled` / `refunded` | terminal; timestamps kept for audit |

When someone later creates a participant profile with the purchaser's verified
email, a database trigger links the order and seats to that profile
(`purchaser_profile_id`), and their own single seat gets `profile_id` +
`confirmed`. Seats bought for other people stay unclaimed.

---

## 5. Cancellations and refunds

`orders/cancelled`
- order: `cancelled_at`, `cancel_reason`, merged `financial_status`
- seats: every seat not already `refunded` → `cancelled` (rows are kept)
- if a cancelled seat already has a roster player the event is `needs_review`
  ("remove them in admin") — rosters are never edited automatically

`refunds/create` — per refunded line item with quantity *q*:
- *q* ≥ refundable seats on that line item → refund them all
- otherwise only seats nobody can be relying on are refunded, highest
  `seat_index` first: already-cancelled seats, then unclaimed seats (no
  profile, no participant email, no roster player)
- if fewer than *q* such seats exist → **nothing on that line item is
  refunded** and the event is `needs_review` (ambiguous partial refund)
- refunds with no line items (manual amount refunds) → `needs_review`, seats
  untouched
- refunds for an order we have never seen: `needs_review` if they touch an
  event product, otherwise `ignored`
- order `financial_status` becomes `refunded` when every seat is refunded,
  `partially_refunded` otherwise

Refunded/cancelled seats never affect the roster tables; admins see the note
in the "Shopify events needing attention" list on the dashboard.

---

## 6. Environment / secrets

| Name | Required | Notes |
| --- | --- | --- |
| `SHOPIFY_WEBHOOK_SECRET` | **yes — not yet set** | The webhook signing secret of the Goosepick-owned Shopify app (Admin → Settings → Notifications → Webhooks shows it for store-created webhooks; for a custom app it is the app's client secret). Set it in Project Settings → Secrets. Until then every request is 503. |
| `SHOPIFY_ALLOWED_SHOP_DOMAINS` | no | Comma-separated allowlist; defaults to `j9j1xd-26.myshopify.com,goosepick.com`. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | auto | Provided to the function by the platform; never exposed client-side. |

---

## 7. Database objects (Phase 3, additive — `db/phase3_shopify_webhook_foundation.sql`, applied)

- `commerce_webhook_events` — event ledger; RLS: admins read, only the service
  role writes.
- `commerce_orders` + `purchaser_name`, `cancelled_at`, `cancel_reason`,
  `shopify_created_at`, `last_webhook_topic`, `last_webhook_at`
- `experience_registrations` + `shopify_product_id`, `shopify_variant_id`,
  `line_item_title`, `line_item_quantity`, `requested_session_key`,
  `unmapped_reason`; partial index on `status = 'unmapped'`
- `shopify_session_mappings` + `occurrence_key` (+ index) and a
  `(product, variant) WHERE is_active` index
- trigger `participant_profiles_link_commerce` (purchaser auto-link on signup)
- `shopify_numeric_id(text)` helper, `admin_resolve_unmapped_registration(uuid, uuid)` RPC

---

## 8. Remaining manual step (owner)

1. Create a Goosepick-owned Shopify app (custom app in the store admin is
   enough) with `read_orders` access, or use the store's own webhook settings.
2. Subscribe these topics to the function URL above, format JSON:
   `orders/paid`, `orders/cancelled`, `refunds/create`.
3. Put the app's webhook signing secret in Project Settings → Secrets as
   `SHOPIFY_WEBHOOK_SECRET`. Nothing is accepted before this exists.
4. Use Shopify's "Send test notification" — expect `200 {"ok":true,"status":"ignored"}`
   (test payloads carry no event products) and a row in `commerce_webhook_events`.
5. Link the current session's variants on the dashboard, add the occurrence key
   to the storefront property, and place a real order.

Not done in this phase (by design): storefront theme edit, webhook
subscription creation, guest seat claim emails.

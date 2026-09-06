/**
 * shopify-order-webhook — pure processing core.
 *
 * Everything in this file is runtime-agnostic (Web Crypto + plain TS) so it
 * is unit-tested with Vitest against an in-memory repository and executed
 * unchanged inside the Deno Edge Function with the Supabase repository.
 *
 * Guarantees this module is responsible for:
 *  - HMAC-SHA256 verification with a constant-time compare (fail closed).
 *  - Idempotency keyed on X-Shopify-Webhook-Id via the event ledger.
 *  - Order → seat sync that is safe to replay and safe out of order.
 *  - STRICT occurrence resolution: an explicit key or explicit date supplied
 *    by the storefront, verified against the mapping table. Never a guess.
 *  - Conservative cancellation / refund handling (never blanket-refund).
 *
 * It never creates roster players; that stays with the admin (Phase 2).
 */

import {
  SESSION_DATE_PROPERTY_NAMES,
  SESSION_KEY_PROPERTY_NAMES,
  isKnownEventProduct,
  normalizeShopifyId,
} from "../_shared/shopify-catalog.ts";

// ---------------------------------------------------------------------------
// Shopify payload shapes (only the fields we read)
// ---------------------------------------------------------------------------

export interface ShopifyNamedValue {
  name?: string | null;
  value?: string | number | null;
}

export interface ShopifyLineItem {
  id: number | string;
  product_id?: number | string | null;
  variant_id?: number | string | null;
  title?: string | null;
  variant_title?: string | null;
  name?: string | null;
  quantity?: number | string | null;
  properties?: ShopifyNamedValue[] | Record<string, unknown> | null;
}

export interface ShopifyCustomer {
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export interface ShopifyAddress {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

export interface ShopifyOrderPayload {
  id: number | string;
  name?: string | null;
  email?: string | null;
  contact_email?: string | null;
  phone?: string | null;
  currency?: string | null;
  total_price?: string | number | null;
  current_total_price?: string | number | null;
  financial_status?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  created_at?: string | null;
  customer?: ShopifyCustomer | null;
  billing_address?: ShopifyAddress | null;
  shipping_address?: ShopifyAddress | null;
  line_items?: ShopifyLineItem[] | null;
  note_attributes?: ShopifyNamedValue[] | null;
}

export interface ShopifyRefundLineItem {
  id?: number | string;
  line_item_id: number | string;
  quantity?: number | string | null;
  line_item?: ShopifyLineItem | null;
}

export interface ShopifyRefundPayload {
  id: number | string;
  order_id: number | string;
  created_at?: string | null;
  note?: string | null;
  refund_line_items?: ShopifyRefundLineItem[] | null;
}

// ---------------------------------------------------------------------------
// Persistence shapes (what the repository stores / returns)
// ---------------------------------------------------------------------------

export type RegistrationStatus =
  | "paid"
  | "profile_required"
  | "confirmed"
  | "cancelled"
  | "refunded"
  | "unmapped";

export type LedgerStatus = "processing" | "processed" | "ignored" | "needs_review" | "error";

export interface MappingRow {
  id: string;
  mapping_key: string;
  occurrence_key: string | null;
  shopify_product_id: string;
  shopify_variant_id: string | null;
  session_id: string | null;
  session_date: string;
  is_active: boolean;
}

export interface ProfileRow {
  id: string;
  email: string;
}

export interface OrderRow {
  id: string;
  shopify_order_id: string;
  financial_status: string | null;
  cancelled_at: string | null;
  purchaser_profile_id: string | null;
}

export interface OrderUpsert {
  shopify_order_id: string;
  shopify_order_name: string | null;
  purchaser_profile_id: string | null;
  purchaser_email: string | null;
  purchaser_phone: string | null;
  purchaser_name: string | null;
  currency: string | null;
  total_amount: number | null;
  financial_status: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  shopify_created_at: string | null;
  raw_payload: unknown;
  processed_at: string;
  last_webhook_topic: string;
  last_webhook_at: string;
}

export interface RegistrationInsert {
  commerce_order_id: string;
  shopify_line_item_id: string;
  seat_index: number;
  mapping_id: string | null;
  session_id: string | null;
  profile_id: string | null;
  purchaser_profile_id: string | null;
  participant_name: string | null;
  participant_email: string | null;
  participant_phone: string | null;
  status: RegistrationStatus;
  cancelled_at: string | null;
  refunded_at: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  line_item_title: string | null;
  line_item_quantity: number;
  requested_session_key: string | null;
  unmapped_reason: string | null;
}

export interface ExistingRegistration {
  id: string;
  commerce_order_id: string | null;
  shopify_line_item_id: string;
  seat_index: number;
  status: RegistrationStatus;
  profile_id: string | null;
  participant_email: string | null;
  /** A public.players row already references this seat. */
  has_player: boolean;
}

export interface ClaimEventInput {
  provider: "shopify";
  webhook_id: string;
  topic: string;
  shop_domain: string | null;
  event_id: string | null;
  api_version: string | null;
  triggered_at: string | null;
  shopify_order_id: string | null;
  payload_hash: string;
  raw_payload: unknown;
}

export type ClaimResult =
  | { outcome: "claimed"; attempt: number }
  | { outcome: "duplicate"; existingStatus: LedgerStatus }
  | { outcome: "in_progress" };

export interface FinalizeEventInput {
  status: Exclude<LedgerStatus, "processing">;
  result: Record<string, unknown>;
  error: string | null;
  shopify_order_id: string | null;
}

export interface WebhookRepository {
  claimEvent(input: ClaimEventInput): Promise<ClaimResult>;
  finalizeEvent(webhookId: string, patch: FinalizeEventInput): Promise<void>;
  /** Rows whose mapping_key OR occurrence_key is in `keys` (active or not). */
  findMappingsByKeys(keys: string[]): Promise<MappingRow[]>;
  /** Every mapping row (active or not) for these canonical product ids. */
  findMappingsForProducts(productIds: string[]): Promise<MappingRow[]>;
  findProfileByEmail(email: string): Promise<ProfileRow | null>;
  getOrder(shopifyOrderId: string): Promise<OrderRow | null>;
  upsertOrder(order: OrderUpsert): Promise<OrderRow>;
  /** INSERT ... ON CONFLICT (shopify_line_item_id, seat_index) DO NOTHING; returns rows inserted. */
  insertRegistrationsIgnoreDuplicates(rows: RegistrationInsert[]): Promise<number>;
  listRegistrationsForOrder(commerceOrderId: string): Promise<ExistingRegistration[]>;
  listRegistrationsForLineItems(lineItemIds: string[]): Promise<ExistingRegistration[]>;
  updateRegistrationStatus(
    ids: string[],
    patch: { status: "cancelled" | "refunded"; at: string },
  ): Promise<number>;
  updateOrderAfterEvent(
    shopifyOrderId: string,
    patch: {
      financial_status?: string | null;
      cancelled_at?: string | null;
      cancel_reason?: string | null;
      last_webhook_topic: string;
      last_webhook_at: string;
    },
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Crypto helpers (Web Crypto — available in Deno and Node ≥ 19)
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64Decode(value: string): Uint8Array | null {
  try {
    const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
    const binary = atob(normalized);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function toBytes(input: Uint8Array | ArrayBuffer | string): Uint8Array {
  if (typeof input === "string") return textEncoder.encode(input);
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

export async function hmacSha256(
  secret: string,
  body: Uint8Array | ArrayBuffer | string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = toBytes(body);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const signature = await crypto.subtle.sign("HMAC", key, copy);
  return new Uint8Array(signature);
}

export async function sha256Hex(body: Uint8Array | ArrayBuffer | string): Promise<string> {
  const bytes = toBytes(body);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return hexEncode(new Uint8Array(digest));
}

/**
 * Verify Shopify's `X-Shopify-Hmac-Sha256` header (base64 of HMAC-SHA256 over
 * the RAW request body with the app's webhook secret). Fails closed on a
 * missing secret, missing/garbled header or any mismatch.
 */
export async function verifyShopifyHmac(
  rawBody: Uint8Array | ArrayBuffer | string,
  headerValue: string | null | undefined,
  secret: string | null | undefined,
): Promise<boolean> {
  if (!secret || secret.length === 0) return false;
  if (!headerValue) return false;
  const provided = base64Decode(headerValue);
  if (!provided || provided.length !== 32) return false;
  const expected = await hmacSha256(secret, rawBody);
  return timingSafeEqual(expected, provided);
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

export const SUPPORTED_TOPICS = ["orders/paid", "orders/cancelled", "refunds/create"] as const;
export type SupportedTopic = (typeof SUPPORTED_TOPICS)[number];

export function isSupportedTopic(topic: string): topic is SupportedTopic {
  return (SUPPORTED_TOPICS as readonly string[]).includes(topic);
}

const cleanString = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

const cleanEmail = (value: unknown): string | null => {
  const text = cleanString(value);
  if (!text || !text.includes("@")) return null;
  return text.toLowerCase();
};

const toQuantity = (value: unknown): number => {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
};

const toAmount = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
};

/** Read a named value from Shopify's `[{name, value}]` arrays or plain objects. */
export function readNamedValue(
  source: ShopifyNamedValue[] | Record<string, unknown> | null | undefined,
  names: readonly string[],
): string | null {
  if (!source) return null;
  const wanted = names.map((n) => n.toLowerCase());
  if (Array.isArray(source)) {
    for (const entry of source) {
      const name = cleanString(entry?.name)?.toLowerCase();
      if (name && wanted.includes(name)) {
        const value = cleanString(entry?.value);
        if (value) return value;
      }
    }
    return null;
  }
  for (const [key, value] of Object.entries(source)) {
    if (wanted.includes(key.toLowerCase())) {
      const text = cleanString(value);
      if (text) return text;
    }
  }
  return null;
}

/** Keys are opaque tokens we issued; anything else is rejected before lookup. */
export const SESSION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_\-.:]{2,79}$/;
export const SESSION_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface PurchaserInfo {
  email: string | null;
  phone: string | null;
  name: string | null;
}

export function extractPurchaser(order: ShopifyOrderPayload): PurchaserInfo {
  const email =
    cleanEmail(order.email) ?? cleanEmail(order.contact_email) ?? cleanEmail(order.customer?.email);
  const phone =
    cleanString(order.phone) ??
    cleanString(order.customer?.phone) ??
    cleanString(order.billing_address?.phone) ??
    cleanString(order.shipping_address?.phone);
  const fromCustomer = [cleanString(order.customer?.first_name), cleanString(order.customer?.last_name)]
    .filter(Boolean)
    .join(" ")
    .trim();
  const fromBilling =
    cleanString(order.billing_address?.name) ??
    [cleanString(order.billing_address?.first_name), cleanString(order.billing_address?.last_name)]
      .filter(Boolean)
      .join(" ")
      .trim();
  const name = fromCustomer || fromBilling || null;
  return { email, phone, name: name && name.length > 0 ? name : null };
}

export interface EventLineItem {
  lineItemId: string;
  productId: string;
  variantId: string | null;
  title: string;
  quantity: number;
  requestedKey: string | null;
  requestedDate: string | null;
}

/**
 * Split an order into event line items (known catalogue products OR products
 * that already have a mapping row) and everything else, which is ignored.
 */
export function classifyLineItems(
  order: ShopifyOrderPayload,
  mappedProductIds: ReadonlySet<string>,
): { eventItems: EventLineItem[]; ignoredCount: number } {
  const eventItems: EventLineItem[] = [];
  let ignoredCount = 0;
  const orderKey = readNamedValue(order.note_attributes ?? null, SESSION_KEY_PROPERTY_NAMES);
  const orderDate = readNamedValue(order.note_attributes ?? null, SESSION_DATE_PROPERTY_NAMES);

  for (const item of order.line_items ?? []) {
    const productId = normalizeShopifyId(item?.product_id);
    const lineItemId = cleanString(item?.id);
    if (!productId || !lineItemId) {
      ignoredCount++;
      continue;
    }
    if (!isKnownEventProduct(productId) && !mappedProductIds.has(productId)) {
      ignoredCount++;
      continue;
    }
    const quantity = toQuantity(item.quantity);
    if (quantity === 0) {
      ignoredCount++;
      continue;
    }
    const title =
      cleanString(item.name) ??
      [cleanString(item.title), cleanString(item.variant_title)].filter(Boolean).join(" — ") ??
      `Line item ${lineItemId}`;
    eventItems.push({
      lineItemId,
      productId,
      variantId: normalizeShopifyId(item.variant_id),
      title: title || `Line item ${lineItemId}`,
      quantity,
      requestedKey: readNamedValue(item.properties ?? null, SESSION_KEY_PROPERTY_NAMES) ?? orderKey,
      requestedDate: readNamedValue(item.properties ?? null, SESSION_DATE_PROPERTY_NAMES) ?? orderDate,
    });
  }
  return { eventItems, ignoredCount };
}

// ---------------------------------------------------------------------------
// Occurrence resolution — strict, never a guess
// ---------------------------------------------------------------------------

export type UnmappedReason =
  | "no_session_key"
  | "key_invalid"
  | "key_unknown"
  | "key_product_mismatch"
  | "key_ambiguous"
  | "date_invalid"
  | "date_unmatched"
  | "date_ambiguous"
  | "mapping_has_no_session";

export interface MappingResolution {
  mapping: MappingRow | null;
  sessionId: string | null;
  reason: UnmappedReason | null;
}

const matchesProduct = (m: MappingRow, item: EventLineItem) =>
  normalizeShopifyId(m.shopify_product_id) === item.productId;

const variantScore = (m: MappingRow, item: EventLineItem): number => {
  const mappingVariant = normalizeShopifyId(m.shopify_variant_id);
  if (mappingVariant === null) return 1; // product-level mapping (any variant)
  if (item.variantId !== null && mappingVariant === item.variantId) return 2; // exact
  return 0; // different variant → not a match
};

/** Exact-variant matches win over product-level ones; zero-score rows are dropped. */
function pickByVariant(candidates: MappingRow[], item: EventLineItem): MappingRow[] {
  const scored = candidates
    .map((m) => ({ m, score: variantScore(m, item) }))
    .filter((c) => c.score > 0);
  if (scored.length === 0) return [];
  const best = Math.max(...scored.map((c) => c.score));
  return scored.filter((c) => c.score === best).map((c) => c.m);
}

export function resolveMapping(
  item: EventLineItem,
  mappingsByKey: readonly MappingRow[],
  mappingsForProducts: readonly MappingRow[],
): MappingResolution {
  const finish = (mapping: MappingRow): MappingResolution =>
    mapping.session_id
      ? { mapping, sessionId: mapping.session_id, reason: null }
      : { mapping, sessionId: null, reason: "mapping_has_no_session" };

  if (item.requestedKey) {
    if (!SESSION_KEY_PATTERN.test(item.requestedKey)) {
      return { mapping: null, sessionId: null, reason: "key_invalid" };
    }
    const keyed = mappingsByKey.filter(
      (m) =>
        m.is_active &&
        (m.mapping_key === item.requestedKey || m.occurrence_key === item.requestedKey),
    );
    if (keyed.length === 0) return { mapping: null, sessionId: null, reason: "key_unknown" };
    const sameProduct = keyed.filter((m) => matchesProduct(m, item));
    const chosen = pickByVariant(sameProduct, item);
    if (chosen.length === 1) return finish(chosen[0]);
    if (chosen.length === 0) return { mapping: null, sessionId: null, reason: "key_product_mismatch" };
    return { mapping: null, sessionId: null, reason: "key_ambiguous" };
  }

  if (item.requestedDate) {
    if (!SESSION_DATE_PATTERN.test(item.requestedDate)) {
      return { mapping: null, sessionId: null, reason: "date_invalid" };
    }
    const dated = mappingsForProducts.filter(
      (m) => m.is_active && matchesProduct(m, item) && m.session_date === item.requestedDate,
    );
    const chosen = pickByVariant(dated, item);
    if (chosen.length === 1) return finish(chosen[0]);
    if (chosen.length === 0) return { mapping: null, sessionId: null, reason: "date_unmatched" };
    return { mapping: null, sessionId: null, reason: "date_ambiguous" };
  }

  return { mapping: null, sessionId: null, reason: "no_session_key" };
}

// ---------------------------------------------------------------------------
// Order → seats
// ---------------------------------------------------------------------------

const FINANCIAL_RANK: Record<string, number> = {
  pending: 0,
  authorized: 0,
  partially_paid: 0,
  paid: 1,
  partially_refunded: 2,
  refunded: 3,
  voided: 3,
};

/** Out-of-order guard: never let a stale "paid" overwrite "refunded". */
export function mergeFinancialStatus(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const inc = cleanString(incoming);
  const ex = cleanString(existing);
  if (!inc) return ex;
  if (!ex) return inc;
  return (FINANCIAL_RANK[inc] ?? 0) >= (FINANCIAL_RANK[ex] ?? 0) ? inc : ex;
}

export interface SeatPlanInput {
  commerceOrderId: string;
  eventItems: EventLineItem[];
  resolutions: Map<string, MappingResolution>;
  purchaser: PurchaserInfo;
  purchaserProfile: ProfileRow | null;
  /** cancelled/refunded when the order is already terminal (out-of-order safe). */
  terminal: "cancelled" | "refunded" | null;
  terminalAt: string | null;
}

/**
 * One row per seat (line item × quantity). Identity rules:
 *  - purchaser_profile_id: purchaser's profile on EVERY seat (they own the booking).
 *  - profile_id / participant_*: ONLY when the whole order is a single event
 *    seat — then it is unambiguously the purchaser's own seat. Multi-seat
 *    orders leave every seat unclaimed (status `paid`) for a later claim flow.
 */
export function planSeatRows(input: SeatPlanInput): RegistrationInsert[] {
  const totalSeats = input.eventItems.reduce((sum, item) => sum + item.quantity, 0);
  const singleSeat = totalSeats === 1;
  const rows: RegistrationInsert[] = [];

  for (const item of input.eventItems) {
    const resolution = input.resolutions.get(item.lineItemId) ?? {
      mapping: null,
      sessionId: null,
      reason: "no_session_key" as const,
    };
    const mapped = resolution.reason === null && resolution.sessionId !== null;
    const ownSeat = singleSeat;
    const profileId = ownSeat && input.purchaserProfile ? input.purchaserProfile.id : null;

    let status: RegistrationStatus;
    if (input.terminal) status = input.terminal;
    else if (!mapped) status = "unmapped";
    else if (profileId) status = "confirmed";
    else if (ownSeat && input.purchaser.email) status = "profile_required";
    else status = "paid";

    for (let seat = 1; seat <= item.quantity; seat++) {
      rows.push({
        commerce_order_id: input.commerceOrderId,
        shopify_line_item_id: item.lineItemId,
        seat_index: seat,
        mapping_id: resolution.mapping?.id ?? null,
        session_id: mapped ? resolution.sessionId : null,
        profile_id: profileId,
        purchaser_profile_id: input.purchaserProfile?.id ?? null,
        participant_name: ownSeat ? input.purchaser.name : null,
        participant_email: ownSeat ? input.purchaser.email : null,
        participant_phone: ownSeat ? input.purchaser.phone : null,
        status,
        cancelled_at: input.terminal === "cancelled" ? input.terminalAt : null,
        refunded_at: input.terminal === "refunded" ? input.terminalAt : null,
        shopify_product_id: item.productId,
        shopify_variant_id: item.variantId,
        line_item_title: item.title,
        line_item_quantity: item.quantity,
        requested_session_key: item.requestedKey,
        unmapped_reason: mapped ? null : resolution.reason,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Refund planning — conservative
// ---------------------------------------------------------------------------

export interface RefundPlan {
  refundIds: string[];
  /** line item ids whose partial refund could not be attributed to seats. */
  ambiguousLineItems: string[];
  /** line item ids in the refund that have no seats (non-event) */
  ignoredLineItems: string[];
  refundedWithPlayers: number;
}

/**
 * For each refunded line item quantity q:
 *  - q ≥ refundable seats → refund all of them (whole line item).
 *  - otherwise refund only seats nobody could be relying on: already-cancelled
 *    first, then unclaimed seats (no profile, no participant email, no roster
 *    player), highest seat_index first. If fewer than q such seats exist the
 *    line item is flagged ambiguous and NOTHING on it is refunded.
 */
export function planRefund(
  refund: ShopifyRefundPayload,
  seats: readonly ExistingRegistration[],
): RefundPlan {
  const byLineItem = new Map<string, ExistingRegistration[]>();
  for (const seat of seats) {
    const list = byLineItem.get(seat.shopify_line_item_id) ?? [];
    list.push(seat);
    byLineItem.set(seat.shopify_line_item_id, list);
  }

  const refundIds: string[] = [];
  const ambiguousLineItems: string[] = [];
  const ignoredLineItems: string[] = [];
  let refundedWithPlayers = 0;

  // Shopify may list the same line item more than once; sum the quantities.
  const requested = new Map<string, number>();
  for (const entry of refund.refund_line_items ?? []) {
    const lineItemId = cleanString(entry?.line_item_id);
    if (!lineItemId) continue;
    requested.set(lineItemId, (requested.get(lineItemId) ?? 0) + toQuantity(entry.quantity));
  }

  for (const [lineItemId, quantity] of requested) {
    const lineSeats = byLineItem.get(lineItemId);
    if (!lineSeats || lineSeats.length === 0) {
      ignoredLineItems.push(lineItemId);
      continue;
    }
    if (quantity === 0) continue;
    const refundable = lineSeats.filter((s) => s.status !== "refunded");
    if (refundable.length === 0) continue;

    let chosen: ExistingRegistration[];
    if (quantity >= refundable.length) {
      chosen = refundable;
    } else {
      const cancelledFirst = refundable
        .filter((s) => s.status === "cancelled")
        .sort((a, b) => b.seat_index - a.seat_index);
      const unclaimed = refundable
        .filter(
          (s) =>
            s.status !== "cancelled" && !s.profile_id && !s.participant_email && !s.has_player,
        )
        .sort((a, b) => b.seat_index - a.seat_index);
      const candidates = [...cancelledFirst, ...unclaimed];
      if (candidates.length < quantity) {
        ambiguousLineItems.push(lineItemId);
        continue;
      }
      chosen = candidates.slice(0, quantity);
    }
    for (const seat of chosen) {
      refundIds.push(seat.id);
      if (seat.has_player) refundedWithPlayers++;
    }
  }

  return { refundIds, ambiguousLineItems, ignoredLineItems, refundedWithPlayers };
}

// ---------------------------------------------------------------------------
// Event processing
// ---------------------------------------------------------------------------

export interface ParsedWebhookEvent {
  webhookId: string;
  topic: string;
  shopDomain: string | null;
  eventId: string | null;
  apiVersion: string | null;
  triggeredAt: string | null;
  payloadHash: string;
  payload: unknown;
}

export interface ProcessOutcome {
  httpStatus: number;
  body: {
    ok: boolean;
    status: "processed" | "ignored" | "needs_review" | "duplicate" | "in_progress" | "error";
    detail?: Record<string, unknown>;
  };
  /** What was written to the ledger (undefined for duplicate / in_progress). */
  ledger?: FinalizeEventInput;
}

export interface ProcessOptions {
  now?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
}

interface HandlerResult {
  status: Exclude<LedgerStatus, "processing" | "error">;
  result: Record<string, unknown>;
  shopifyOrderId: string | null;
}

const payloadOrderId = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  return cleanString(p.order_id) ?? cleanString(p.id);
};

export async function processShopifyWebhook(
  repo: WebhookRepository,
  event: ParsedWebhookEvent,
  options: ProcessOptions = {},
): Promise<ProcessOutcome> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => {});
  const base = { webhook_id: event.webhookId, topic: event.topic };

  const claim = await repo.claimEvent({
    provider: "shopify",
    webhook_id: event.webhookId,
    topic: event.topic,
    shop_domain: event.shopDomain,
    event_id: event.eventId,
    api_version: event.apiVersion,
    triggered_at: event.triggeredAt,
    shopify_order_id: payloadOrderId(event.payload),
    payload_hash: event.payloadHash,
    raw_payload: event.payload,
  });

  if (claim.outcome === "duplicate") {
    log({ ...base, outcome: "duplicate", previous: claim.existingStatus });
    return {
      httpStatus: 200,
      body: { ok: true, status: "duplicate", detail: { previous: claim.existingStatus } },
    };
  }
  if (claim.outcome === "in_progress") {
    log({ ...base, outcome: "in_progress" });
    return { httpStatus: 503, body: { ok: false, status: "in_progress" } };
  }

  let handled: HandlerResult;
  try {
    const nowIso = now().toISOString();
    if (!isSupportedTopic(event.topic)) {
      handled = { status: "ignored", result: { reason: "unsupported_topic" }, shopifyOrderId: null };
    } else if (event.topic === "orders/paid") {
      handled = await handleOrderPaid(repo, event.payload as ShopifyOrderPayload, nowIso, event.topic);
    } else if (event.topic === "orders/cancelled") {
      handled = await handleOrderCancelled(repo, event.payload as ShopifyOrderPayload, nowIso, event.topic);
    } else {
      handled = await handleRefundCreate(repo, event.payload as ShopifyRefundPayload, nowIso, event.topic);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const ledger: FinalizeEventInput = {
      status: "error",
      result: { attempt: claim.attempt },
      error: message.slice(0, 1000),
      shopify_order_id: payloadOrderId(event.payload),
    };
    await repo.finalizeEvent(event.webhookId, ledger);
    log({ ...base, outcome: "error", attempt: claim.attempt, error: ledger.error });
    return { httpStatus: 500, body: { ok: false, status: "error" }, ledger };
  }

  const ledger: FinalizeEventInput = {
    status: handled.status,
    result: { ...handled.result, attempt: claim.attempt },
    error: null,
    shopify_order_id: handled.shopifyOrderId,
  };
  await repo.finalizeEvent(event.webhookId, ledger);
  log({ ...base, outcome: handled.status, ...handled.result });
  return {
    httpStatus: 200,
    body: { ok: true, status: handled.status, detail: handled.result },
    ledger,
  };
}

async function loadMappingContext(
  repo: WebhookRepository,
  order: ShopifyOrderPayload,
): Promise<{
  eventItems: EventLineItem[];
  ignoredCount: number;
  mappingsByKey: MappingRow[];
  mappingsForProducts: MappingRow[];
}> {
  const productIds = Array.from(
    new Set(
      (order.line_items ?? [])
        .map((li) => normalizeShopifyId(li?.product_id))
        .filter((id): id is string => id !== null),
    ),
  );
  const mappingsForProducts = productIds.length ? await repo.findMappingsForProducts(productIds) : [];
  const mappedProductIds = new Set(
    mappingsForProducts
      .map((m) => normalizeShopifyId(m.shopify_product_id))
      .filter((id): id is string => id !== null),
  );
  const { eventItems, ignoredCount } = classifyLineItems(order, mappedProductIds);
  const keys = Array.from(
    new Set(
      eventItems
        .map((i) => i.requestedKey)
        .filter((k): k is string => !!k && SESSION_KEY_PATTERN.test(k)),
    ),
  );
  const mappingsByKey = keys.length ? await repo.findMappingsByKeys(keys) : [];
  return { eventItems, ignoredCount, mappingsByKey, mappingsForProducts };
}

/**
 * Shared by orders/paid and orders/cancelled: make sure the order row and its
 * seat rows exist (replay-safe), then report what happened.
 */
async function syncOrderAndSeats(
  repo: WebhookRepository,
  order: ShopifyOrderPayload,
  nowIso: string,
  topic: string,
  forceTerminal: "cancelled" | null,
): Promise<{
  orderRow: OrderRow | null;
  eventItems: EventLineItem[];
  ignoredCount: number;
  rows: RegistrationInsert[];
  inserted: number;
  unmappedSeats: number;
  purchaserProfileLinked: boolean;
  terminal: "cancelled" | "refunded" | null;
}> {
  const shopifyOrderId = cleanString(order.id);
  if (!shopifyOrderId) throw new Error("Order payload has no id");

  const ctx = await loadMappingContext(repo, order);
  if (ctx.eventItems.length === 0) {
    return {
      orderRow: null,
      eventItems: [],
      ignoredCount: ctx.ignoredCount,
      rows: [],
      inserted: 0,
      unmappedSeats: 0,
      purchaserProfileLinked: false,
      terminal: null,
    };
  }

  const purchaser = extractPurchaser(order);
  const existing = await repo.getOrder(shopifyOrderId);
  const purchaserProfile = purchaser.email ? await repo.findProfileByEmail(purchaser.email) : null;

  const cancelledAt =
    forceTerminal === "cancelled"
      ? cleanString(order.cancelled_at) ?? nowIso
      : cleanString(order.cancelled_at) ?? existing?.cancelled_at ?? null;
  const financialStatus = mergeFinancialStatus(existing?.financial_status, order.financial_status);
  const terminal: "cancelled" | "refunded" | null = cancelledAt
    ? "cancelled"
    : financialStatus === "refunded" || financialStatus === "voided"
      ? "refunded"
      : null;

  const orderRow = await repo.upsertOrder({
    shopify_order_id: shopifyOrderId,
    shopify_order_name: cleanString(order.name),
    purchaser_profile_id: purchaserProfile?.id ?? existing?.purchaser_profile_id ?? null,
    purchaser_email: purchaser.email,
    purchaser_phone: purchaser.phone,
    purchaser_name: purchaser.name,
    currency: cleanString(order.currency),
    total_amount: toAmount(order.current_total_price) ?? toAmount(order.total_price),
    financial_status: financialStatus,
    cancelled_at: cancelledAt,
    cancel_reason: cleanString(order.cancel_reason),
    shopify_created_at: cleanString(order.created_at),
    raw_payload: order,
    processed_at: nowIso,
    last_webhook_topic: topic,
    last_webhook_at: nowIso,
  });

  const resolutions = new Map<string, MappingResolution>();
  for (const item of ctx.eventItems) {
    resolutions.set(item.lineItemId, resolveMapping(item, ctx.mappingsByKey, ctx.mappingsForProducts));
  }

  const rows = planSeatRows({
    commerceOrderId: orderRow.id,
    eventItems: ctx.eventItems,
    resolutions,
    purchaser,
    purchaserProfile,
    terminal,
    terminalAt: terminal ? (cancelledAt ?? nowIso) : null,
  });
  const inserted = rows.length ? await repo.insertRegistrationsIgnoreDuplicates(rows) : 0;

  return {
    orderRow,
    eventItems: ctx.eventItems,
    ignoredCount: ctx.ignoredCount,
    rows,
    inserted,
    unmappedSeats: rows.filter((r) => r.status === "unmapped").length,
    purchaserProfileLinked: purchaserProfile !== null,
    terminal,
  };
}

async function handleOrderPaid(
  repo: WebhookRepository,
  order: ShopifyOrderPayload,
  nowIso: string,
  topic: string,
): Promise<HandlerResult> {
  const sync = await syncOrderAndSeats(repo, order, nowIso, topic, null);
  const shopifyOrderId = cleanString(order.id);
  if (sync.eventItems.length === 0) {
    return {
      status: "ignored",
      result: { reason: "no_event_line_items", ignored_line_items: sync.ignoredCount },
      shopifyOrderId,
    };
  }
  const financial = cleanString(order.financial_status);
  const partiallyRefundedBeforeSeats = financial === "partially_refunded" && sync.inserted > 0;
  const result: Record<string, unknown> = {
    event_line_items: sync.eventItems.length,
    ignored_line_items: sync.ignoredCount,
    seats_total: sync.rows.length,
    seats_inserted: sync.inserted,
    seats_existing: sync.rows.length - sync.inserted,
    unmapped_seats: sync.unmappedSeats,
    unmapped_reasons: Array.from(
      new Set(sync.rows.map((r) => r.unmapped_reason).filter((r): r is string => !!r)),
    ),
    single_seat_order: sync.rows.length === 1,
    purchaser_profile_linked: sync.purchaserProfileLinked,
    terminal_status: sync.terminal,
  };
  if (partiallyRefundedBeforeSeats) result.note = "order was partially refunded before seats were created";
  const needsReview = sync.unmappedSeats > 0 || partiallyRefundedBeforeSeats;
  return { status: needsReview ? "needs_review" : "processed", result, shopifyOrderId };
}

async function handleOrderCancelled(
  repo: WebhookRepository,
  order: ShopifyOrderPayload,
  nowIso: string,
  topic: string,
): Promise<HandlerResult> {
  const shopifyOrderId = cleanString(order.id);
  if (!shopifyOrderId) throw new Error("Order payload has no id");
  const cancelledAt = cleanString(order.cancelled_at) ?? nowIso;

  const sync = await syncOrderAndSeats(repo, order, nowIso, topic, "cancelled");
  if (!sync.orderRow) {
    return {
      status: "ignored",
      result: { reason: "no_event_line_items", ignored_line_items: sync.ignoredCount },
      shopifyOrderId,
    };
  }

  const seats = await repo.listRegistrationsForOrder(sync.orderRow.id);
  const toCancel = seats.filter((s) => s.status !== "cancelled" && s.status !== "refunded");
  const cancelled = toCancel.length
    ? await repo.updateRegistrationStatus(
        toCancel.map((s) => s.id),
        { status: "cancelled", at: cancelledAt },
      )
    : 0;
  const withPlayers = toCancel.filter((s) => s.has_player).length;

  await repo.updateOrderAfterEvent(shopifyOrderId, {
    financial_status: mergeFinancialStatus(sync.orderRow.financial_status, order.financial_status),
    cancelled_at: cancelledAt,
    cancel_reason: cleanString(order.cancel_reason),
    last_webhook_topic: topic,
    last_webhook_at: nowIso,
  });

  const result: Record<string, unknown> = {
    seats_total: seats.length,
    seats_cancelled: cancelled,
    seats_created_as_cancelled: sync.inserted,
    seats_already_refunded: seats.filter((s) => s.status === "refunded").length,
    cancelled_seats_with_players: withPlayers,
  };
  if (withPlayers > 0) result.note = "cancelled seats still have roster players — remove them in admin";
  return { status: withPlayers > 0 ? "needs_review" : "processed", result, shopifyOrderId };
}

async function handleRefundCreate(
  repo: WebhookRepository,
  refund: ShopifyRefundPayload,
  nowIso: string,
  topic: string,
): Promise<HandlerResult> {
  const shopifyOrderId = cleanString(refund.order_id);
  if (!shopifyOrderId) throw new Error("Refund payload has no order_id");
  const refundedAt = cleanString(refund.created_at) ?? nowIso;
  const refundItems = refund.refund_line_items ?? [];

  const order = await repo.getOrder(shopifyOrderId);
  if (!order) {
    const touchesEvent = refundItems.some((r) => isKnownEventProduct(r?.line_item?.product_id));
    return touchesEvent
      ? {
          status: "needs_review",
          result: { reason: "order_not_found", note: "refund arrived before/without the paid order" },
          shopifyOrderId,
        }
      : { status: "ignored", result: { reason: "unknown_order_no_event_items" }, shopifyOrderId };
  }

  if (refundItems.length === 0) {
    return {
      status: "needs_review",
      result: { reason: "refund_without_line_items", note: "manual amount refund — seats untouched" },
      shopifyOrderId,
    };
  }

  const lineItemIds = Array.from(
    new Set(refundItems.map((r) => cleanString(r?.line_item_id)).filter((id): id is string => !!id)),
  );
  const seats = await repo.listRegistrationsForLineItems(lineItemIds);
  const plan = planRefund(refund, seats);
  const refunded = plan.refundIds.length
    ? await repo.updateRegistrationStatus(plan.refundIds, { status: "refunded", at: refundedAt })
    : 0;

  const allSeats = await repo.listRegistrationsForOrder(order.id);
  const everySeatRefunded = allSeats.length > 0 && allSeats.every((s) => s.status === "refunded");
  await repo.updateOrderAfterEvent(shopifyOrderId, {
    financial_status: mergeFinancialStatus(
      order.financial_status,
      everySeatRefunded ? "refunded" : refunded > 0 ? "partially_refunded" : null,
    ),
    last_webhook_topic: topic,
    last_webhook_at: nowIso,
  });

  const result: Record<string, unknown> = {
    refund_line_items: refundItems.length,
    seats_refunded: refunded,
    ambiguous_line_items: plan.ambiguousLineItems.length,
    ignored_line_items: plan.ignoredLineItems.length,
    refunded_seats_with_players: plan.refundedWithPlayers,
    order_fully_refunded: everySeatRefunded,
  };
  if (plan.ambiguousLineItems.length > 0) {
    result.note = "partial refund could not be attributed to specific seats — nothing on those line items was refunded";
  } else if (plan.refundedWithPlayers > 0) {
    result.note = "refunded seats still have roster players — remove them in admin";
  }
  const needsReview = plan.ambiguousLineItems.length > 0 || plan.refundedWithPlayers > 0;
  return { status: needsReview ? "needs_review" : "processed", result, shopifyOrderId };
}

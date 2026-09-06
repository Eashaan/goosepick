// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  base64Encode,
  hmacSha256,
  mergeFinancialStatus,
  planRefund,
  processShopifyWebhook,
  sha256Hex,
  verifyShopifyHmac,
  type ClaimEventInput,
  type ClaimResult,
  type ExistingRegistration,
  type FinalizeEventInput,
  type MappingRow,
  type OrderRow,
  type OrderUpsert,
  type ParsedWebhookEvent,
  type ProfileRow,
  type RegistrationInsert,
  type ShopifyOrderPayload,
  type ShopifyRefundPayload,
  type WebhookRepository,
} from "../../supabase/functions/shopify-order-webhook/lib.ts";
import {
  DEFAULT_ALLOWED_SHOP_DOMAINS,
  SHOPIFY_EVENT_PRODUCTS,
  describeVariant,
  findEventVariant,
  isAllowedShopDomain,
  normalizeShopifyId,
} from "../../supabase/functions/_shared/shopify-catalog.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// ---------------------------------------------------------------------------
// In-memory repository
// ---------------------------------------------------------------------------

interface LedgerRow extends ClaimEventInput {
  status: string;
  attempt_count: number;
  result: Record<string, unknown>;
  error: string | null;
}

interface StoredRegistration extends RegistrationInsert {
  id: string;
}

class MemoryRepo implements WebhookRepository {
  ledger = new Map<string, LedgerRow>();
  mappings: MappingRow[] = [];
  profiles: ProfileRow[] = [];
  orders = new Map<string, OrderRow & OrderUpsert>();
  registrations: StoredRegistration[] = [];
  playersByRegistration = new Set<string>();
  private seq = 0;

  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async claimEvent(input: ClaimEventInput): Promise<ClaimResult> {
    const existing = this.ledger.get(input.webhook_id);
    if (!existing) {
      this.ledger.set(input.webhook_id, { ...input, status: "processing", attempt_count: 1, result: {}, error: null });
      return { outcome: "claimed", attempt: 1 };
    }
    if (["processed", "ignored", "needs_review"].includes(existing.status)) {
      return { outcome: "duplicate", existingStatus: existing.status as never };
    }
    if (existing.status === "processing") return { outcome: "in_progress" };
    existing.status = "processing";
    existing.attempt_count += 1;
    return { outcome: "claimed", attempt: existing.attempt_count };
  }

  async finalizeEvent(webhookId: string, patch: FinalizeEventInput): Promise<void> {
    const row = this.ledger.get(webhookId)!;
    row.status = patch.status;
    row.result = patch.result;
    row.error = patch.error;
    row.shopify_order_id = patch.shopify_order_id;
  }

  async findMappingsByKeys(keys: string[]): Promise<MappingRow[]> {
    return this.mappings.filter((m) => keys.includes(m.mapping_key) || (m.occurrence_key ? keys.includes(m.occurrence_key) : false));
  }

  async findMappingsForProducts(productIds: string[]): Promise<MappingRow[]> {
    return this.mappings.filter((m) => productIds.includes(normalizeShopifyId(m.shopify_product_id) ?? ""));
  }

  async findProfileByEmail(email: string): Promise<ProfileRow | null> {
    return this.profiles.find((p) => p.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async getOrder(shopifyOrderId: string): Promise<OrderRow | null> {
    return this.orders.get(shopifyOrderId) ?? null;
  }

  async upsertOrder(order: OrderUpsert): Promise<OrderRow> {
    const existing = this.orders.get(order.shopify_order_id);
    const row = { ...(existing ?? { id: this.nextId("order") }), ...order } as OrderRow & OrderUpsert;
    this.orders.set(order.shopify_order_id, row);
    return row;
  }

  async insertRegistrationsIgnoreDuplicates(rows: RegistrationInsert[]): Promise<number> {
    let inserted = 0;
    for (const row of rows) {
      const clash = this.registrations.find(
        (r) => r.shopify_line_item_id === row.shopify_line_item_id && r.seat_index === row.seat_index,
      );
      if (clash) continue;
      this.registrations.push({ ...row, id: this.nextId("reg") });
      inserted++;
    }
    return inserted;
  }

  private toExisting(r: StoredRegistration): ExistingRegistration {
    return {
      id: r.id,
      commerce_order_id: r.commerce_order_id,
      shopify_line_item_id: r.shopify_line_item_id,
      seat_index: r.seat_index,
      status: r.status,
      profile_id: r.profile_id,
      participant_email: r.participant_email,
      has_player: this.playersByRegistration.has(r.id),
    };
  }

  async listRegistrationsForOrder(commerceOrderId: string): Promise<ExistingRegistration[]> {
    return this.registrations.filter((r) => r.commerce_order_id === commerceOrderId).map((r) => this.toExisting(r));
  }

  async listRegistrationsForLineItems(lineItemIds: string[]): Promise<ExistingRegistration[]> {
    return this.registrations.filter((r) => lineItemIds.includes(r.shopify_line_item_id)).map((r) => this.toExisting(r));
  }

  async updateRegistrationStatus(ids: string[], patch: { status: "cancelled" | "refunded"; at: string }): Promise<number> {
    let n = 0;
    for (const r of this.registrations) {
      if (!ids.includes(r.id)) continue;
      r.status = patch.status;
      if (patch.status === "cancelled") r.cancelled_at = patch.at;
      else r.refunded_at = patch.at;
      n++;
    }
    return n;
  }

  async updateOrderAfterEvent(shopifyOrderId: string, patch: Record<string, unknown>): Promise<void> {
    const row = this.orders.get(shopifyOrderId);
    if (row) Object.assign(row, patch);
  }

  seats(lineItemId: string) {
    return this.registrations
      .filter((r) => r.shopify_line_item_id === lineItemId)
      .sort((a, b) => a.seat_index - b.seat_index);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOCIAL = SHOPIFY_EVENT_PRODUCTS[0];
const THURSDAYS = SHOPIFY_EVENT_PRODUCTS[1];
const EARLY_BIRD = SOCIAL.variants[0].variantId;
const GENERAL = SOCIAL.variants[1].variantId;
const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";

const mapping = (over: Partial<MappingRow>): MappingRow => ({
  id: over.id ?? `map_${Math.random().toString(36).slice(2, 8)}`,
  mapping_key: over.mapping_key ?? "gp_11111111_abc123_eb",
  occurrence_key: over.occurrence_key ?? "gp_11111111_abc123",
  shopify_product_id: over.shopify_product_id ?? SOCIAL.productId,
  shopify_variant_id: over.shopify_variant_id === undefined ? EARLY_BIRD : over.shopify_variant_id,
  session_id: over.session_id === undefined ? SESSION_A : over.session_id,
  session_date: over.session_date ?? "2026-09-12",
  is_active: over.is_active ?? true,
});

const socialMappings = () => [
  mapping({ id: "map_eb", mapping_key: "gp_11111111_abc123_eb", shopify_variant_id: EARLY_BIRD }),
  mapping({ id: "map_gen", mapping_key: "gp_11111111_abc123_gen", shopify_variant_id: GENERAL }),
];

interface LineOpts {
  id?: string;
  productId?: string;
  variantId?: string | null;
  quantity?: number;
  key?: string | null;
  date?: string | null;
  title?: string;
}

const line = (o: LineOpts = {}) => {
  const properties: { name: string; value: string }[] = [];
  if (o.key) properties.push({ name: "_goosepick_session_key", value: o.key });
  if (o.date) properties.push({ name: "_goosepick_session_date", value: o.date });
  return {
    id: Number(o.id ?? 9001),
    product_id: Number(o.productId ?? SOCIAL.productId),
    variant_id: o.variantId === null ? null : Number(o.variantId ?? EARLY_BIRD),
    title: o.title ?? "Goosepick Social",
    variant_title: "Early Bird",
    name: o.title ?? "Goosepick Social - Early Bird",
    quantity: o.quantity ?? 1,
    properties,
  };
};

const order = (over: Partial<ShopifyOrderPayload> & { line_items?: ReturnType<typeof line>[] } = {}): ShopifyOrderPayload => ({
  id: 5001,
  name: "#1001",
  email: "buyer@example.com",
  phone: "+919999999999",
  currency: "INR",
  total_price: "999.00",
  financial_status: "paid",
  cancelled_at: null,
  created_at: "2026-09-01T10:00:00+05:30",
  customer: { email: "buyer@example.com", first_name: "Bala", last_name: "Buyer" },
  line_items: [line()],
  ...over,
});

let webhookSeq = 0;
const event = (topic: string, payload: unknown, webhookId?: string): ParsedWebhookEvent => ({
  webhookId: webhookId ?? `wh_${++webhookSeq}`,
  topic,
  shopDomain: "j9j1xd-26.myshopify.com",
  eventId: null,
  apiVersion: "2025-07",
  triggeredAt: null,
  payloadHash: "hash",
  payload,
});

const paid = (repo: MemoryRepo, o: ShopifyOrderPayload, id?: string) =>
  processShopifyWebhook(repo, event("orders/paid", o, id), { now: () => new Date("2026-09-01T05:00:00Z") });

// ---------------------------------------------------------------------------
// HMAC verification
// ---------------------------------------------------------------------------

const hexToBase64 = (hex: string) =>
  base64Encode(new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16))));

describe("HMAC verification (RFC 4231 vectors, fail closed)", () => {
  it("matches RFC 4231 test case 2 (key 'Jefe')", async () => {
    const expectedHex = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";
    const sig = await hmacSha256("Jefe", "what do ya want for nothing?");
    expect(Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("")).toBe(expectedHex);
    expect(await verifyShopifyHmac("what do ya want for nothing?", hexToBase64(expectedHex), "Jefe")).toBe(true);
  });

  it("matches RFC 4231 test case 1 over raw bytes", async () => {
    const key = String.fromCharCode(...new Array(20).fill(0x0b));
    const expectedHex = "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7";
    const body = new TextEncoder().encode("Hi There");
    expect(await verifyShopifyHmac(body, hexToBase64(expectedHex), key)).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets, garbage and missing headers", async () => {
    const secret = "shpss_test_secret";
    const body = JSON.stringify({ id: 1, line_items: [] });
    const good = base64Encode(await hmacSha256(secret, body));
    expect(await verifyShopifyHmac(body, good, secret)).toBe(true);
    expect(await verifyShopifyHmac(body + " ", good, secret)).toBe(false);
    expect(await verifyShopifyHmac(body, good, "other-secret")).toBe(false);
    expect(await verifyShopifyHmac(body, good.slice(0, -4) + "AAAA", secret)).toBe(false);
    expect(await verifyShopifyHmac(body, "not base64!!", secret)).toBe(false);
    expect(await verifyShopifyHmac(body, "", secret)).toBe(false);
    expect(await verifyShopifyHmac(body, null, secret)).toBe(false);
  });

  it("fails closed when the secret is missing or empty", async () => {
    const body = "{}";
    const sig = base64Encode(await hmacSha256("x", body));
    expect(await verifyShopifyHmac(body, sig, "")).toBe(false);
    expect(await verifyShopifyHmac(body, sig, null)).toBe(false);
    expect(await verifyShopifyHmac(body, sig, undefined)).toBe(false);
  });

  it("hashes payloads deterministically for the ledger", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("shop domain allowlist + catalogue", () => {
  it("accepts only the configured store domains (case-insensitive)", () => {
    expect(DEFAULT_ALLOWED_SHOP_DOMAINS).toContain("j9j1xd-26.myshopify.com");
    expect(isAllowedShopDomain("J9J1XD-26.myshopify.com")).toBe(true);
    expect(isAllowedShopDomain("goosepick.com")).toBe(true);
    expect(isAllowedShopDomain("evil.myshopify.com")).toBe(false);
    expect(isAllowedShopDomain(null)).toBe(false);
    expect(isAllowedShopDomain("goosepick.com", ["other.myshopify.com"])).toBe(false);
  });

  it("normalises numeric ids and GIDs to one canonical form", () => {
    expect(normalizeShopifyId("gid://shopify/Product/8555007901886")).toBe("8555007901886");
    expect(normalizeShopifyId(8555007901886)).toBe("8555007901886");
    expect(normalizeShopifyId(" 45309100523710 ")).toBe("45309100523710");
    expect(normalizeShopifyId("Goosepick Social")).toBeNull();
    expect(normalizeShopifyId(null)).toBeNull();
  });

  it("knows the live event products and their variants", () => {
    expect(SOCIAL.productId).toBe("8555007901886");
    expect(THURSDAYS.productId).toBe("8915933724862");
    expect(THURSDAYS.variants).toHaveLength(10);
    expect(findEventVariant("gid://shopify/Product/8555007901886", "gid://shopify/ProductVariant/48209652089022")?.variant.title).toBe("Early Bird");
    expect(describeVariant(SOCIAL.productId, GENERAL)).toBe("Goosepick Social — General");
    expect(describeVariant(THURSDAYS.productId, null)).toBe("Goosepick Thursdays — all variants");
  });
});

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

describe("orders/paid — idempotency and classification", () => {
  it("processes a duplicate webhook id exactly once", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    const o = order({ line_items: [line({ key: "gp_11111111_abc123", quantity: 2 })] });

    const first = await paid(repo, o, "wh_dup");
    expect(first.httpStatus).toBe(200);
    expect(first.body.status).toBe("processed");
    expect(repo.registrations).toHaveLength(2);

    const second = await paid(repo, o, "wh_dup");
    expect(second.httpStatus).toBe(200);
    expect(second.body.status).toBe("duplicate");
    expect(repo.registrations).toHaveLength(2);
    expect(repo.ledger.get("wh_dup")?.attempt_count).toBe(1);
  });

  it("replays with a NEW webhook id never create extra seats", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    const o = order({ line_items: [line({ key: "gp_11111111_abc123", quantity: 3 })] });
    await paid(repo, o, "wh_a");
    const replay = await paid(repo, o, "wh_b");
    expect(replay.body.status).toBe("processed");
    expect(replay.body.detail).toMatchObject({ seats_total: 3, seats_inserted: 0, seats_existing: 3 });
    expect(repo.registrations).toHaveLength(3);
  });

  it("ignores orders with no event products and stores nothing", async () => {
    const repo = new MemoryRepo();
    const o = order({ line_items: [line({ productId: "8893861822654", variantId: "48210604982462", title: "Rogue WingPro" })] });
    const out = await paid(repo, o);
    expect(out.httpStatus).toBe(200);
    expect(out.body.status).toBe("ignored");
    expect(out.body.detail).toMatchObject({ reason: "no_event_line_items" });
    expect(repo.orders.size).toBe(0);
    expect(repo.registrations).toHaveLength(0);
    expect(repo.ledger.get(out.ledger ? [...repo.ledger.keys()][0] : "")?.status).toBe("ignored");
  });

  it("returns 503 while the same webhook is still being processed", async () => {
    const repo = new MemoryRepo();
    repo.ledger.set("wh_busy", {
      provider: "shopify", webhook_id: "wh_busy", topic: "orders/paid", shop_domain: null, event_id: null,
      api_version: null, triggered_at: null, shopify_order_id: null, payload_hash: "h", raw_payload: {},
      status: "processing", attempt_count: 1, result: {}, error: null,
    });
    const out = await paid(repo, order(), "wh_busy");
    expect(out.httpStatus).toBe(503);
    expect(out.body.status).toBe("in_progress");
  });

  it("records a retriable error (500) and retries on the next delivery", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    const broken = Object.create(repo) as MemoryRepo;
    let calls = 0;
    broken.upsertOrder = async (o) => {
      calls++;
      if (calls === 1) throw new Error("db offline");
      return MemoryRepo.prototype.upsertOrder.call(repo, o);
    };
    const o = order({ line_items: [line({ key: "gp_11111111_abc123" })] });
    const first = await processShopifyWebhook(broken, event("orders/paid", o, "wh_err"));
    expect(first.httpStatus).toBe(500);
    expect(repo.ledger.get("wh_err")?.status).toBe("error");
    const second = await processShopifyWebhook(broken, event("orders/paid", o, "wh_err"));
    expect(second.httpStatus).toBe(200);
    expect(second.body.status).toBe("processed");
    expect(repo.ledger.get("wh_err")?.attempt_count).toBe(2);
  });
});

describe("orders/paid — strict occurrence resolution", () => {
  it("resolves an exact mapping_key and links the session", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    const out = await paid(repo, order({ line_items: [line({ key: "gp_11111111_abc123_eb" })] }));
    expect(out.body.status).toBe("processed");
    const [seat] = repo.registrations;
    expect(seat.mapping_id).toBe("map_eb");
    expect(seat.session_id).toBe(SESSION_A);
    expect(seat.status).toBe("profile_required");
    expect(seat.requested_session_key).toBe("gp_11111111_abc123_eb");
    expect(seat.unmapped_reason).toBeNull();
  });

  it("one shared occurrence key picks the row for the purchased variant", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    await paid(repo, order({ line_items: [line({ key: "gp_11111111_abc123", variantId: GENERAL, id: "77" })] }));
    expect(repo.seats("77")[0].mapping_id).toBe("map_gen");
    expect(repo.seats("77")[0].session_id).toBe(SESSION_A);
  });

  it("accepts the key from order note_attributes when the line item has none", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    await paid(repo, order({ line_items: [line({})], note_attributes: [{ name: "goosepick_session_key", value: "gp_11111111_abc123" }] }));
    expect(repo.registrations[0].session_id).toBe(SESSION_A);
  });

  it("NEVER guesses: no key → unmapped even with exactly one active mapping", async () => {
    const repo = new MemoryRepo();
    repo.mappings = [mapping({ id: "only", shopify_variant_id: EARLY_BIRD })];
    const out = await paid(repo, order({ line_items: [line({})] }));
    expect(out.body.status).toBe("needs_review");
    const [seat] = repo.registrations;
    expect(seat.status).toBe("unmapped");
    expect(seat.session_id).toBeNull();
    expect(seat.mapping_id).toBeNull();
    expect(seat.unmapped_reason).toBe("no_session_key");
    // product / variant are still recorded so the admin can attach it later
    expect(seat.shopify_product_id).toBe(SOCIAL.productId);
    expect(seat.shopify_variant_id).toBe(EARLY_BIRD);
  });

  it("unknown key → unmapped (key_unknown); key of another product → key_product_mismatch", async () => {
    const repo = new MemoryRepo();
    repo.mappings = [
      ...socialMappings(),
      mapping({ id: "thu", mapping_key: "gp_22222222_thu_b", occurrence_key: "gp_22222222_thu", shopify_product_id: THURSDAYS.productId, shopify_variant_id: THURSDAYS.variants[0].variantId, session_id: SESSION_B }),
    ];
    await paid(repo, order({ id: 1, line_items: [line({ id: "1", key: "gp_does_not_exist" })] }));
    await paid(repo, order({ id: 2, line_items: [line({ id: "2", key: "gp_22222222_thu" })] }));
    expect(repo.seats("1")[0].unmapped_reason).toBe("key_unknown");
    expect(repo.seats("2")[0].unmapped_reason).toBe("key_product_mismatch");
    expect(repo.seats("2")[0].status).toBe("unmapped");
  });

  it("rejects malformed keys before lookup and ignores inactive mappings", async () => {
    const repo = new MemoryRepo();
    repo.mappings = [mapping({ id: "off", mapping_key: "gp_off", occurrence_key: "gp_off", is_active: false })];
    await paid(repo, order({ id: 1, line_items: [line({ id: "1", key: "'; drop table--" })] }));
    await paid(repo, order({ id: 2, line_items: [line({ id: "2", key: "gp_off" })] }));
    expect(repo.seats("1")[0].unmapped_reason).toBe("key_invalid");
    expect(repo.seats("2")[0].unmapped_reason).toBe("key_unknown");
  });

  it("explicit date fallback works only when exactly one active mapping matches", async () => {
    const repo = new MemoryRepo();
    repo.mappings = [mapping({ id: "d1", mapping_key: "k1", occurrence_key: "o1", session_date: "2026-09-12" })];
    await paid(repo, order({ id: 1, line_items: [line({ id: "1", date: "2026-09-12" })] }));
    expect(repo.seats("1")[0].session_id).toBe(SESSION_A);

    // Same product+variant+date in another scope → ambiguous → unmapped
    repo.mappings.push(mapping({ id: "d2", mapping_key: "k2", occurrence_key: "o2", session_date: "2026-09-12", session_id: SESSION_B }));
    await paid(repo, order({ id: 2, line_items: [line({ id: "2", date: "2026-09-12" })] }));
    expect(repo.seats("2")[0].status).toBe("unmapped");
    expect(repo.seats("2")[0].unmapped_reason).toBe("date_ambiguous");

    await paid(repo, order({ id: 3, line_items: [line({ id: "3", date: "2026-10-01" })] }));
    expect(repo.seats("3")[0].unmapped_reason).toBe("date_unmatched");
    await paid(repo, order({ id: 4, line_items: [line({ id: "4", date: "12/09/2026" })] }));
    expect(repo.seats("4")[0].unmapped_reason).toBe("date_invalid");
  });

  it("a mapping without a session yet stays visible as unmapped", async () => {
    const repo = new MemoryRepo();
    repo.mappings = [mapping({ id: "nosess", mapping_key: "gp_nosess", occurrence_key: "gp_nosess", session_id: null })];
    await paid(repo, order({ line_items: [line({ key: "gp_nosess" })] }));
    expect(repo.registrations[0].status).toBe("unmapped");
    expect(repo.registrations[0].mapping_id).toBe("nosess");
    expect(repo.registrations[0].unmapped_reason).toBe("mapping_has_no_session");
  });
});

describe("orders/paid — seats and identity", () => {
  it("quantity N creates exactly N seats with seat_index 1..N", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    const out = await paid(repo, order({ line_items: [line({ id: "42", key: "gp_11111111_abc123", quantity: 4 })] }));
    expect(out.body.detail).toMatchObject({ seats_total: 4, seats_inserted: 4 });
    expect(repo.seats("42").map((s) => s.seat_index)).toEqual([1, 2, 3, 4]);
    expect(repo.seats("42").every((s) => s.line_item_quantity === 4)).toBe(true);
  });

  it("multi-ticket: purchaser owns the booking but is NOT every participant", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    repo.profiles = [{ id: "prof_buyer", email: "buyer@example.com" }];
    await paid(repo, order({ line_items: [line({ id: "42", key: "gp_11111111_abc123", quantity: 3 })] }));
    const seats = repo.seats("42");
    expect(seats.every((s) => s.purchaser_profile_id === "prof_buyer")).toBe(true);
    expect(seats.every((s) => s.profile_id === null)).toBe(true);
    expect(seats.every((s) => s.participant_email === null && s.participant_name === null)).toBe(true);
    expect(seats.every((s) => s.status === "paid")).toBe(true);
    expect(repo.orders.get("5001")?.purchaser_profile_id).toBe("prof_buyer");
  });

  it("single seat + existing profile → the purchaser's own confirmed seat", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    repo.profiles = [{ id: "prof_buyer", email: "Buyer@Example.com" }];
    await paid(repo, order({ line_items: [line({ key: "gp_11111111_abc123" })] }));
    const [seat] = repo.registrations;
    expect(seat.profile_id).toBe("prof_buyer");
    expect(seat.purchaser_profile_id).toBe("prof_buyer");
    expect(seat.status).toBe("confirmed");
    expect(seat.participant_email).toBe("buyer@example.com");
    expect(seat.participant_name).toBe("Bala Buyer");
  });

  it("single seat without a profile → profile_required, contact captured for later claim", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    await paid(repo, order({ line_items: [line({ key: "gp_11111111_abc123" })] }));
    const [seat] = repo.registrations;
    expect(seat.profile_id).toBeNull();
    expect(seat.status).toBe("profile_required");
    expect(seat.participant_email).toBe("buyer@example.com");
    expect(seat.participant_phone).toBe("+919999999999");
  });

  it("two single-quantity event lines in one order are still a multi-seat order", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    repo.profiles = [{ id: "prof_buyer", email: "buyer@example.com" }];
    await paid(repo, order({ line_items: [line({ id: "1", key: "gp_11111111_abc123" }), line({ id: "2", key: "gp_11111111_abc123", variantId: GENERAL })] }));
    expect(repo.registrations).toHaveLength(2);
    expect(repo.registrations.every((s) => s.profile_id === null && s.status === "paid")).toBe(true);
  });

  it("never creates roster players", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    await paid(repo, order({ line_items: [line({ key: "gp_11111111_abc123", quantity: 2 })] }));
    expect(repo.playersByRegistration.size).toBe(0);
  });
});

describe("orders/cancelled", () => {
  it("cancels every active seat, leaves refunded seats alone, preserves audit", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    await paid(repo, order({ line_items: [line({ id: "42", key: "gp_11111111_abc123", quantity: 3 })] }));
    repo.seats("42")[2].status = "refunded";

    const out = await processShopifyWebhook(repo, event("orders/cancelled", order({ cancelled_at: "2026-09-02T10:00:00Z", cancel_reason: "customer", financial_status: "voided", line_items: [line({ id: "42", key: "gp_11111111_abc123", quantity: 3 })] })));
    expect(out.body.status).toBe("processed");
    expect(out.body.detail).toMatchObject({ seats_cancelled: 2, seats_already_refunded: 1 });
    const seats = repo.seats("42");
    expect(seats.map((s) => s.status)).toEqual(["cancelled", "cancelled", "refunded"]);
    expect(seats[0].cancelled_at).toBe("2026-09-02T10:00:00Z");
    expect(repo.orders.get("5001")).toMatchObject({ cancelled_at: "2026-09-02T10:00:00Z", cancel_reason: "customer", financial_status: "voided" });
    expect(repo.registrations).toHaveLength(3);
  });

  it("flags for review when a cancelled seat already has a roster player", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    await paid(repo, order({ line_items: [line({ id: "42", key: "gp_11111111_abc123", quantity: 2 })] }));
    repo.playersByRegistration.add(repo.seats("42")[0].id);
    const out = await processShopifyWebhook(repo, event("orders/cancelled", order({ cancelled_at: "2026-09-02T10:00:00Z" })));
    expect(out.body.status).toBe("needs_review");
    expect(out.body.detail).toMatchObject({ cancelled_seats_with_players: 1 });
  });

  it("out of order: cancel before paid → seats are created as cancelled, never active", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    const o = order({ line_items: [line({ id: "42", key: "gp_11111111_abc123", quantity: 2 })] });
    await processShopifyWebhook(repo, event("orders/cancelled", { ...o, cancelled_at: "2026-09-02T10:00:00Z" }));
    expect(repo.seats("42").every((s) => s.status === "cancelled")).toBe(true);
    const late = await paid(repo, o);
    expect(late.body.status).toBe("processed");
    expect(late.body.detail).toMatchObject({ seats_inserted: 0, terminal_status: "cancelled" });
    expect(repo.seats("42").every((s) => s.status === "cancelled")).toBe(true);
    expect(repo.orders.get("5001")?.cancelled_at).toBe("2026-09-02T10:00:00Z");
  });

  it("ignores cancellations of non-event orders", async () => {
    const repo = new MemoryRepo();
    const out = await processShopifyWebhook(repo, event("orders/cancelled", order({ line_items: [line({ productId: "8893861822654", variantId: "48210604982462" })] })));
    expect(out.body.status).toBe("ignored");
    expect(repo.orders.size).toBe(0);
  });
});

describe("refunds/create", () => {
  const refund = (items: Array<{ line_item_id: string; quantity: number; product_id?: string }>, over: Partial<ShopifyRefundPayload> = {}): ShopifyRefundPayload => ({
    id: 7001,
    order_id: 5001,
    created_at: "2026-09-03T10:00:00Z",
    refund_line_items: items.map((i, idx) => ({ id: idx + 1, line_item_id: Number(i.line_item_id), quantity: i.quantity, line_item: { id: Number(i.line_item_id), product_id: Number(i.product_id ?? SOCIAL.productId) } })),
    ...over,
  });

  const seeded = async (quantity = 3) => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    await paid(repo, order({ line_items: [line({ id: "42", key: "gp_11111111_abc123", quantity })] }));
    return repo;
  };

  it("full refund of a line item refunds every seat and marks the order refunded", async () => {
    const repo = await seeded(3);
    const out = await processShopifyWebhook(repo, event("refunds/create", refund([{ line_item_id: "42", quantity: 3 }])));
    expect(out.body.status).toBe("processed");
    expect(repo.seats("42").every((s) => s.status === "refunded" && s.refunded_at === "2026-09-03T10:00:00Z")).toBe(true);
    expect(repo.orders.get("5001")?.financial_status).toBe("refunded");
  });

  it("partial refund takes only unclaimed seats without players, highest seat first", async () => {
    const repo = await seeded(3);
    const seats = repo.seats("42");
    repo.playersByRegistration.add(seats[2].id); // seat 3 is on a roster
    const out = await processShopifyWebhook(repo, event("refunds/create", refund([{ line_item_id: "42", quantity: 1 }])));
    expect(out.body.status).toBe("processed");
    expect(repo.seats("42").map((s) => s.status)).toEqual(["paid", "refunded", "paid"]);
    expect(repo.orders.get("5001")?.financial_status).toBe("partially_refunded");
  });

  it("ambiguous partial refund refunds NOTHING on that line item and needs review", async () => {
    const repo = await seeded(3);
    const seats = repo.seats("42");
    seats[0].profile_id = "prof_x"; // claimed
    repo.playersByRegistration.add(seats[1].id); // rostered
    repo.playersByRegistration.add(seats[2].id); // rostered
    const out = await processShopifyWebhook(repo, event("refunds/create", refund([{ line_item_id: "42", quantity: 1 }])));
    expect(out.body.status).toBe("needs_review");
    expect(out.body.detail).toMatchObject({ seats_refunded: 0, ambiguous_line_items: 1 });
    expect(repo.seats("42").every((s) => s.status === "paid")).toBe(true);
  });

  it("does not touch other line items and ignores non-event refund lines", async () => {
    const repo = new MemoryRepo();
    repo.mappings = socialMappings();
    await paid(repo, order({ line_items: [line({ id: "42", key: "gp_11111111_abc123", quantity: 2 }), line({ id: "43", key: "gp_11111111_abc123", variantId: GENERAL, quantity: 2 })] }));
    const out = await processShopifyWebhook(repo, event("refunds/create", refund([{ line_item_id: "43", quantity: 2 }, { line_item_id: "999", quantity: 1, product_id: "8893861822654" }])));
    expect(out.body.status).toBe("processed");
    expect(repo.seats("42").every((s) => s.status === "paid")).toBe(true);
    expect(repo.seats("43").every((s) => s.status === "refunded")).toBe(true);
    expect(out.body.detail).toMatchObject({ seats_refunded: 2, ignored_line_items: 1, order_fully_refunded: false });
  });

  it("previously cancelled seats become refunded when the money goes back", async () => {
    const repo = await seeded(2);
    await processShopifyWebhook(repo, event("orders/cancelled", order({ cancelled_at: "2026-09-02T10:00:00Z", line_items: [line({ id: "42", key: "gp_11111111_abc123", quantity: 2 })] })));
    await processShopifyWebhook(repo, event("refunds/create", refund([{ line_item_id: "42", quantity: 2 }])));
    expect(repo.seats("42").every((s) => s.status === "refunded")).toBe(true);
  });

  it("refund with no line items or for an unknown event order needs review; unknown non-event is ignored", async () => {
    const repo = await seeded(1);
    const noLines = await processShopifyWebhook(repo, event("refunds/create", refund([])));
    expect(noLines.body.status).toBe("needs_review");
    expect(repo.registrations[0].status).toBe("profile_required");

    const unknownEvent = await processShopifyWebhook(repo, event("refunds/create", refund([{ line_item_id: "1", quantity: 1 }], { order_id: 4242 })));
    expect(unknownEvent.body.status).toBe("needs_review");
    const unknownOther = await processShopifyWebhook(repo, event("refunds/create", refund([{ line_item_id: "1", quantity: 1, product_id: "8893861822654" }], { order_id: 4343 })));
    expect(unknownOther.body.status).toBe("ignored");
  });

  it("planRefund sums repeated line items and never exceeds refundable seats", () => {
    const seats: ExistingRegistration[] = [1, 2, 3].map((i) => ({ id: `r${i}`, commerce_order_id: "o", shopify_line_item_id: "42", seat_index: i, status: "paid", profile_id: null, participant_email: null, has_player: false }));
    const plan = planRefund({ id: 1, order_id: 1, refund_line_items: [{ line_item_id: 42, quantity: 1 }, { line_item_id: 42, quantity: 1 }] }, seats);
    expect(plan.refundIds).toEqual(["r3", "r2"]);
    expect(planRefund({ id: 1, order_id: 1, refund_line_items: [{ line_item_id: 42, quantity: 9 }] }, seats).refundIds).toHaveLength(3);
  });
});

describe("financial status merge (out-of-order safety)", () => {
  it("never downgrades a refunded order back to paid", () => {
    expect(mergeFinancialStatus("refunded", "paid")).toBe("refunded");
    expect(mergeFinancialStatus("paid", "partially_refunded")).toBe("partially_refunded");
    expect(mergeFinancialStatus(null, "paid")).toBe("paid");
    expect(mergeFinancialStatus("paid", null)).toBe("paid");
  });
});

describe("unsupported topics + source guards", () => {
  it("records unsupported topics as ignored without touching data", async () => {
    const repo = new MemoryRepo();
    const out = await processShopifyWebhook(repo, event("products/update", { id: 1 }));
    expect(out.body.status).toBe("ignored");
    expect(repo.orders.size).toBe(0);
  });

  it("edge function fails closed and authenticates before any parsing", () => {
    const src = read("supabase/functions/shopify-order-webhook/index.ts");
    const secretCheck = src.indexOf('Deno.env.get("SHOPIFY_WEBHOOK_SECRET")');
    const hmacCheck = src.indexOf("verifyShopifyHmac(raw, hmacHeader, secret)");
    const domainCheck = src.indexOf("isAllowedShopDomain(shopDomain, allowed)");
    const jsonParse = src.indexOf("JSON.parse(");
    expect(secretCheck).toBeGreaterThan(-1);
    expect(hmacCheck).toBeGreaterThan(secretCheck);
    expect(domainCheck).toBeGreaterThan(hmacCheck);
    expect(jsonParse).toBeGreaterThan(domainCheck);
    expect(src).toContain("return json(503");
    expect(src).toContain("return json(401");
    expect(src).toContain("req.arrayBuffer()");
    expect(src).not.toMatch(/await req\.json\(\)/);
    expect(src).not.toContain("Access-Control-Allow-Origin");
  });

  it("webhook function is deployed without gateway JWT verification", () => {
    const toml = read("supabase/config.toml");
    expect(toml).toMatch(/\[functions\.shopify-order-webhook\]\s*\nverify_jwt = false/);
  });

  it("Phase 3 SQL is additive, service-role-only for the ledger and revokes function EXECUTE", () => {
    const sql = read("db/phase3_shopify_webhook_foundation.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.commerce_webhook_events");
    expect(sql).toContain("UNIQUE (provider, webhook_id)");
    expect(sql).toContain("REVOKE ALL ON public.commerce_webhook_events FROM anon;");
    expect(sql).toContain("REVOKE ALL ON public.commerce_webhook_events FROM authenticated;");
    expect(sql).toContain("GRANT SELECT ON public.commerce_webhook_events TO authenticated;");
    expect(sql).toMatch(/CREATE POLICY "Admins can view webhook events"[\s\S]*FOR SELECT TO authenticated[\s\S]*USING \(public\.is_admin\(\)\)/);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*commerce_webhook_events[^;]*FOR (INSERT|UPDATE|DELETE|ALL)/);
    for (const fn of ["link_participant_profile_on_signup()", "admin_resolve_unmapped_registration(uuid, uuid)", "shopify_numeric_id(text)"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC;`);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM anon;`);
    }
    expect(sql).not.toMatch(/\bDROP TABLE\b|\bDROP COLUMN\b|\bALTER COLUMN\b|\bTRUNCATE\b|\bDELETE FROM\b/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS occurrence_key text/);
  });

  it("no browser code touches the service role or the webhook secret", () => {
    const files = ["src/lib/shopifyCatalog.ts", "src/hooks/useShopifyMappings.ts", "src/components/admin/ShopifyMappingPanel.tsx"];
    for (const f of files) {
      const src = read(f);
      expect(src).not.toContain("SERVICE_ROLE");
      expect(src).not.toContain("SHOPIFY_WEBHOOK_SECRET");
    }
  });
});

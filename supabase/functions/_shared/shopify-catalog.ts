/**
 * Goosepick ↔ Shopify catalogue constants.
 *
 * Runtime-agnostic (no Deno / browser APIs) so the same file is imported by
 * the `shopify-order-webhook` Edge Function and, via `src/lib/shopifyCatalog.ts`,
 * by the admin UI. Product / variant ids are the ONLY identity used anywhere —
 * titles are display hints and are never used to infer a session.
 *
 * Future: replace the static list with a synced copy from the Shopify Admin
 * API. Keep the exported shapes stable so callers do not change.
 */

export type GoosepickEventType = "social" | "thursdays";

export interface ShopifyVariantRef {
  /** Numeric id as a string, e.g. "48209652089022" (canonical storage form). */
  variantId: string;
  gid: string;
  title: string;
  /** Thursdays only: the venue encoded in the variant title. */
  venue?: string;
  /** Thursdays only: the skill band encoded in the variant title. */
  skill?: string;
}

export interface ShopifyEventProduct {
  productId: string;
  gid: string;
  handle: string;
  title: string;
  eventType: GoosepickEventType;
  variants: ShopifyVariantRef[];
}

/** Custom domain of the store (what the owner calls it). */
export const SHOPIFY_STORE_PRIMARY_DOMAIN = "goosepick.com";
/**
 * The permanent *.myshopify.com domain. Shopify puts THIS value in the
 * `X-Shopify-Shop-Domain` header, never the custom domain.
 */
export const SHOPIFY_STORE_MYSHOPIFY_DOMAIN = "j9j1xd-26.myshopify.com";

export const DEFAULT_ALLOWED_SHOP_DOMAINS: readonly string[] = [
  SHOPIFY_STORE_MYSHOPIFY_DOMAIN,
  SHOPIFY_STORE_PRIMARY_DOMAIN,
];

/**
 * Line item property names the storefront may use to attach the occurrence
 * key. A leading underscore hides the property from the customer in Shopify's
 * cart/checkout/order UI, so `_goosepick_session_key` is the recommended one.
 */
export const SESSION_KEY_PROPERTY_NAMES: readonly string[] = [
  "_goosepick_session_key",
  "goosepick_session_key",
];

/** Optional explicit occurrence DATE (YYYY-MM-DD) — only used as a strict fallback. */
export const SESSION_DATE_PROPERTY_NAMES: readonly string[] = [
  "_goosepick_session_date",
  "goosepick_session_date",
];

const variant = (
  variantId: string,
  title: string,
  extra: Partial<Pick<ShopifyVariantRef, "venue" | "skill">> = {},
): ShopifyVariantRef => ({
  variantId,
  gid: `gid://shopify/ProductVariant/${variantId}`,
  title,
  ...extra,
});

export const SHOPIFY_EVENT_PRODUCTS: readonly ShopifyEventProduct[] = [
  {
    productId: "8555007901886",
    gid: "gid://shopify/Product/8555007901886",
    handle: "goosepick-social",
    title: "Goosepick Social",
    eventType: "social",
    variants: [
      variant("48209652089022", "Early Bird"),
      variant("45309100523710", "General"),
    ],
  },
  {
    productId: "8915933724862",
    gid: "gid://shopify/Product/8915933724862",
    handle: "goosepick-thursdays",
    title: "Goosepick Thursdays",
    eventType: "thursdays",
    variants: [
      variant("48787061932222", "Bandra / Beginner", { venue: "Bandra", skill: "Beginner" }),
      variant("48697902366910", "Bandra / Beginner+ (<3.0)", { venue: "Bandra", skill: "Beginner+ (<3.0)" }),
      variant("48787061964990", "Bandra / Intermediate (<3.4)", { venue: "Bandra", skill: "Intermediate (<3.4)" }),
      variant("48697913802942", "Bandra / Intermediate+ (<3.8)", { venue: "Bandra", skill: "Intermediate+ (<3.8)" }),
      variant("48697913835710", "Bandra / Advanced (>3.8)", { venue: "Bandra", skill: "Advanced (>3.8)" }),
      variant("48787061997758", "Andheri / Beginner", { venue: "Andheri", skill: "Beginner" }),
      variant("48697913868478", "Andheri / Beginner+ (<3.0)", { venue: "Andheri", skill: "Beginner+ (<3.0)" }),
      variant("48787062030526", "Andheri / Intermediate (<3.4)", { venue: "Andheri", skill: "Intermediate (<3.4)" }),
      variant("48697913901246", "Andheri / Intermediate+ (<3.8)", { venue: "Andheri", skill: "Intermediate+ (<3.8)" }),
      variant("48697913934014", "Andheri / Advanced (>3.8)", { venue: "Andheri", skill: "Advanced (>3.8)" }),
    ],
  },
];

/**
 * Canonical id form: the numeric id as a string. Accepts numbers, numeric
 * strings and GIDs (`gid://shopify/Product/123`). Returns null for anything
 * empty / unparseable so callers never compare against garbage.
 */
export function normalizeShopifyId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const stripped = text.replace(/^gid:\/\/shopify\/[A-Za-z]+\//, "");
  if (!/^\d{1,30}$/.test(stripped)) return null;
  return stripped;
}

export function toProductGid(productId: string): string {
  return `gid://shopify/Product/${productId}`;
}

export function toVariantGid(variantId: string): string {
  return `gid://shopify/ProductVariant/${variantId}`;
}

export function findEventProduct(productId: unknown): ShopifyEventProduct | undefined {
  const id = normalizeShopifyId(productId);
  if (!id) return undefined;
  return SHOPIFY_EVENT_PRODUCTS.find((p) => p.productId === id);
}

export function isKnownEventProduct(productId: unknown): boolean {
  return findEventProduct(productId) !== undefined;
}

export function findEventVariant(
  productId: unknown,
  variantId: unknown,
): { product: ShopifyEventProduct; variant: ShopifyVariantRef } | undefined {
  const product = findEventProduct(productId);
  const id = normalizeShopifyId(variantId);
  if (!product || !id) return undefined;
  const found = product.variants.find((v) => v.variantId === id);
  return found ? { product, variant: found } : undefined;
}

export function eventProductsForType(eventType: GoosepickEventType): ShopifyEventProduct[] {
  return SHOPIFY_EVENT_PRODUCTS.filter((p) => p.eventType === eventType);
}

/** Human label for a product/variant pair, falling back to raw ids. */
export function describeVariant(productId: unknown, variantId: unknown): string {
  const match = findEventVariant(productId, variantId);
  if (match) return `${match.product.title} — ${match.variant.title}`;
  const product = findEventProduct(productId);
  const vid = normalizeShopifyId(variantId);
  if (product) return vid ? `${product.title} — variant ${vid}` : `${product.title} — all variants`;
  const pid = normalizeShopifyId(productId);
  return vid ? `Product ${pid ?? "?"} / variant ${vid}` : `Product ${pid ?? "?"}`;
}

/** Case-insensitive host match against an allowlist (no wildcards). */
export function isAllowedShopDomain(
  shopDomain: string | null | undefined,
  allowed: readonly string[] = DEFAULT_ALLOWED_SHOP_DOMAINS,
): boolean {
  if (!shopDomain) return false;
  const host = shopDomain.trim().toLowerCase();
  if (!host) return false;
  return allowed.some((d) => d.trim().toLowerCase() === host);
}

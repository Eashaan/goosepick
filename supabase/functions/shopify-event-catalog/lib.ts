/**
 * Pure normalization for the public Shopify event catalogue.
 *
 * Runtime-agnostic (no Deno / fetch / database) so the storefront contract can
 * be unit-tested. Input is the public `/products/<handle>.js` payload; output is
 * a normalized product + variant list with semantic dimensions inferred from
 * structured Shopify option names first and legacy titles second.
 *
 * Nothing here guesses a city from a venue: an unknown dimension stays null so
 * the admin UI can warn instead of silently inventing scope.
 */
import type { GoosepickEventType } from "../_shared/shopify-catalog.ts";
import { normalizeShopifyId } from "../_shared/shopify-catalog.ts";

export type CatalogDimension = "city" | "venue" | "skill" | "ticketType";

export interface CatalogVariant {
  /** Numeric Shopify variant id as a string. */
  variantId: string;
  title: string;
  available: boolean;
  /** Raw Shopify option name → value, exactly as the store defines them. */
  optionValues: Record<string, string>;
  city: string | null;
  venue: string | null;
  skill: string | null;
  ticketType: string | null;
}

export interface CatalogProduct {
  productId: string;
  handle: string;
  title: string;
  eventType: GoosepickEventType;
  /** Shopify option names in position order. */
  options: string[];
  variants: CatalogVariant[];
  /** Which semantic dimensions came from structured option names. */
  structuredDimensions: CatalogDimension[];
}

/** Raw shape of the fields we read from `/products/<handle>.js`. */
export interface ShopifyPublicProduct {
  id?: unknown;
  title?: unknown;
  handle?: unknown;
  options?: unknown;
  variants?: unknown;
}

const DIMENSION_PATTERNS: Array<{ dimension: CatalogDimension; test: RegExp }> = [
  { dimension: "city", test: /^\s*(city|town|metro)\s*$/i },
  { dimension: "venue", test: /^\s*(venue|location|locality|area|club|court\s*venue)\s*$/i },
  { dimension: "skill", test: /^\s*(skill|skill\s*level|level|rating|grade|band)\s*$/i },
  { dimension: "ticketType", test: /^\s*(ticket\s*type|ticket|tier|pass|type)\s*$/i },
];

/** Map a Shopify option NAME onto a semantic dimension (null when unknown). */
export function dimensionForOptionName(name: string): CatalogDimension | null {
  for (const entry of DIMENSION_PATTERNS) {
    if (entry.test.test(name)) return entry.dimension;
  }
  return null;
}

const clean = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
};

/** Option names, tolerating both the string[] and {name,position}[] payloads. */
export function readOptionNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const entries: Array<{ name: string; position: number }> = [];
  raw.forEach((option, index) => {
    if (typeof option === "string") {
      const name = clean(option);
      if (name) entries.push({ name, position: index + 1 });
      return;
    }
    if (option && typeof option === "object") {
      const rec = option as Record<string, unknown>;
      const name = clean(rec.name);
      if (!name) return;
      const position = typeof rec.position === "number" ? rec.position : index + 1;
      entries.push({ name, position });
    }
  });
  return entries.sort((a, b) => a.position - b.position).map((e) => e.name);
}

const readVariantOptionValues = (raw: Record<string, unknown>): string[] => {
  if (Array.isArray(raw.options)) {
    return raw.options.map((v) => clean(v) ?? "");
  }
  const out: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const value = clean(raw[`option${i}`]);
    if (value) out.push(value);
  }
  return out;
};

/**
 * Legacy fallback for stores that encode everything in one option, e.g.
 * `Bandra / Intermediate (<3.4)` → venue + skill. A single-part title is a
 * ticket type (`Early Bird`, `General`). City is never inferred.
 */
export function inferFromLegacyTitle(title: string): {
  venue: string | null;
  skill: string | null;
  ticketType: string | null;
} {
  const parts = title
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return { venue: parts[0], skill: parts.slice(1).join(" / "), ticketType: null };
  if (parts.length === 1) return { venue: null, skill: null, ticketType: parts[0] };
  return { venue: null, skill: null, ticketType: null };
}

/**
 * Normalize one public Shopify product into the admin-facing contract.
 * `productId` / `eventType` come from the static catalogue (the safety
 * boundary) — never from the fetched payload.
 */
export function normalizePublicProduct(
  raw: ShopifyPublicProduct,
  known: { productId: string; handle: string; eventType: GoosepickEventType; title: string },
): CatalogProduct {
  const options = readOptionNames(raw.options);
  const dimensionByIndex = options.map(dimensionForOptionName);
  const structured = [...new Set(dimensionByIndex.filter((d): d is CatalogDimension => d !== null))];

  const variants: CatalogVariant[] = [];
  const rawVariants = Array.isArray(raw.variants) ? raw.variants : [];
  for (const entry of rawVariants) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const variantId = normalizeShopifyId(rec.id);
    if (!variantId) continue;
    const values = readVariantOptionValues(rec);
    const title = clean(rec.title) ?? values.filter(Boolean).join(" / ") ?? "";

    const optionValues: Record<string, string> = {};
    options.forEach((name, index) => {
      const value = values[index];
      if (value) optionValues[name] = value;
    });

    let city: string | null = null;
    let venue: string | null = null;
    let skill: string | null = null;
    let ticketType: string | null = null;
    dimensionByIndex.forEach((dimension, index) => {
      const value = values[index] ?? null;
      if (!dimension || !value) return;
      if (dimension === "city") city = value;
      else if (dimension === "venue") venue = value;
      else if (dimension === "skill") skill = value;
      else ticketType = value;
    });

    if (!venue && !skill && !ticketType) {
      const legacy = inferFromLegacyTitle(title);
      venue = venue ?? legacy.venue;
      skill = skill ?? legacy.skill;
      ticketType = ticketType ?? legacy.ticketType;
    }

    variants.push({
      variantId,
      title,
      available: rec.available !== false,
      optionValues,
      city,
      venue,
      skill,
      ticketType,
    });
  }

  return {
    productId: known.productId,
    handle: known.handle,
    title: clean(raw.title) ?? known.title,
    eventType: known.eventType,
    options,
    variants,
    structuredDimensions: structured,
  };
}

/** Compact human label, e.g. `Mumbai · Bandra · Intermediate`. */
export function describeCatalogVariant(
  variant: Pick<CatalogVariant, "city" | "venue" | "skill" | "ticketType" | "title">,
): string {
  const parts = [variant.city, variant.venue, variant.skill, variant.ticketType].filter(
    (p): p is string => Boolean(p),
  );
  return parts.length > 0 ? parts.join(" · ") : variant.title;
}

/**
 * Pure grouping/filtering logic for the public occurrence feed.
 *
 * Runtime-agnostic so the storefront contract can be unit-tested without Deno
 * or a database. Nothing here touches PII: the only fields that ever leave the
 * database are the occurrence key, the session date, a display label and the
 * Shopify variant ids.
 */
import { normalizeShopifyId } from "../_shared/shopify-catalog.ts";

/** One `shopify_session_mappings` row joined to its session. */
export interface OccurrenceMappingRow {
  occurrence_key: string | null;
  session_date: string | null;
  session_id: string | null;
  is_active: boolean | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  metadata?: unknown;
  session?: { status?: string | null; date?: string | null; capacity?: number | null } | null;
}

export interface PublicOccurrence {
  /** Opaque occurrence key the storefront must send back as a line item property. */
  key: string;
  /** ISO date (YYYY-MM-DD) of the event. */
  date: string;
  label?: string;
  /** Variant ids explicitly linked to this occurrence (empty when product-level only). */
  variant_ids: string[];
  /** True when a product-level mapping makes every variant valid. */
  all_variants: boolean;
  /** Seat limit for the date, or null when there is no limit. */
  capacity: number | null;
  /** Seats still available, or null when there is no limit. */
  remaining: number | null;
  /** True when the seat limit is reached — the storefront should block buying. */
  sold_out: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

const labelFromMetadata = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).label;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
};

/**
 * Filter to bookable occurrences and group mapping rows by occurrence key.
 * Excluded: inactive mappings, mappings with no session, missing sessions,
 * ended sessions and past dates. Sorted ascending by date.
 */
export function buildPublicOccurrences(
  rows: readonly OccurrenceMappingRow[],
  options: {
    productId: string;
    variantId?: string | null;
    today?: string;
    /** Seats already sold per session id, used to derive remaining seats. */
    bookedBySession?: Readonly<Record<string, number>>;
  },
): PublicOccurrence[] {
  const productId = normalizeShopifyId(options.productId);
  if (!productId) return [];
  const wantedVariant = normalizeShopifyId(options.variantId ?? null);
  const today = options.today ?? todayIso();

  const booked = options.bookedBySession ?? {};
  const grouped = new Map<
    string,
    {
      date: string;
      label: string | null;
      variants: Set<string>;
      all: boolean;
      capacity: number | null;
      sold: number;
    }
  >();

  for (const row of rows) {
    if (row.is_active !== true) continue;
    if (!row.session_id) continue;
    if (!row.session || !row.session.status) continue;
    if (row.session.status === "ended") continue;
    if (normalizeShopifyId(row.shopify_product_id) !== productId) continue;

    const date = row.session.date ?? row.session_date;
    if (!date || !ISO_DATE.test(date) || date < today) continue;

    const key = row.occurrence_key?.trim();
    if (!key) continue;

    const variantId = normalizeShopifyId(row.shopify_variant_id);
    const isProductLevel = variantId === null;
    if (wantedVariant && !isProductLevel && variantId !== wantedVariant) continue;

    const entry =
      grouped.get(key) ??
      { date, label: null, variants: new Set<string>(), all: false, capacity: null, sold: 0 };
    entry.date = date;
    const capacity = row.session.capacity ?? null;
    entry.capacity = typeof capacity === "number" && capacity > 0 ? capacity : entry.capacity;
    entry.sold = Math.max(entry.sold, (row.session_id ? booked[row.session_id] : 0) ?? 0);
    entry.label = entry.label ?? labelFromMetadata(row.metadata);
    if (isProductLevel) entry.all = true;
    else entry.variants.add(variantId);
    grouped.set(key, entry);
  }

  const occurrences: PublicOccurrence[] = [];
  for (const [key, entry] of grouped) {
    occurrences.push({
      key,
      date: entry.date,
      ...(entry.label ? { label: entry.label } : {}),
      variant_ids: [...entry.variants].sort(),
      all_variants: entry.all,
      capacity: entry.capacity,
      remaining: entry.capacity === null ? null : Math.max(entry.capacity - entry.sold, 0),
      sold_out: entry.capacity !== null && entry.sold >= entry.capacity,
    });
  }

  occurrences.sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date < b.date ? -1 : 1));
  return occurrences;
}

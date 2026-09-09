import { useQuery } from "@tanstack/react-query";
import {
  SHOPIFY_EVENT_PRODUCTS,
  eventProductsForType,
  normalizeShopifyId,
  type GoosepickEventType,
} from "@/lib/shopifyCatalog";
import {
  inferFromLegacyTitle,
  type CatalogProduct,
  type CatalogVariant,
} from "../../supabase/functions/shopify-event-catalog/lib";

export const EVENT_CATALOG_QUERY_KEY = "shopify_event_catalog";

const FUNCTION_NAME = "shopify-event-catalog";

/** Static catalogue rendered in the same shape — the graceful fallback. */
export function staticCatalogFor(eventType: GoosepickEventType | null): CatalogProduct[] {
  const products = eventType ? eventProductsForType(eventType) : [...SHOPIFY_EVENT_PRODUCTS];
  return products.map((product) => ({
    productId: product.productId,
    handle: product.handle,
    title: product.title,
    eventType: product.eventType,
    options: [],
    structuredDimensions: [],
    variants: product.variants.map((variant) => {
      const legacy = inferFromLegacyTitle(variant.title);
      return {
        variantId: variant.variantId,
        title: variant.title,
        available: true,
        optionValues: {},
        city: null,
        venue: variant.venue ?? legacy.venue,
        skill: variant.skill ?? legacy.skill,
        ticketType: legacy.ticketType,
      } satisfies CatalogVariant;
    }),
  }));
}

export interface EventCatalogResult {
  products: CatalogProduct[];
  /** True when the list came from the live Shopify storefront. */
  live: boolean;
}

/**
 * Live Shopify product/variant catalogue for one event type, falling back to
 * the static catalogue whenever the public endpoint is unreachable so mappings
 * never break.
 */
export function useEventCatalog(eventType: GoosepickEventType | null | undefined) {
  return useQuery({
    queryKey: [EVENT_CATALOG_QUERY_KEY, eventType ?? "all"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<EventCatalogResult> => {
      const fallback: EventCatalogResult = { products: staticCatalogFor(eventType ?? null), live: false };
      const base = import.meta.env.VITE_SUPABASE_URL;
      if (!base) return fallback;
      try {
        const url = new URL(`${base}/functions/v1/${FUNCTION_NAME}`);
        if (eventType) url.searchParams.set("event_type", eventType);
        const res = await fetch(url.toString(), {
          headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "" },
        });
        if (!res.ok) return fallback;
        const body = (await res.json()) as { ok?: boolean; products?: CatalogProduct[] };
        if (!body?.ok || !Array.isArray(body.products) || body.products.length === 0) return fallback;
        return { products: body.products, live: true };
      } catch {
        return fallback;
      }
    },
  });
}

/** Find one variant in a catalogue result. */
export function findCatalogVariant(
  products: readonly CatalogProduct[],
  productId: unknown,
  variantId: unknown,
): { product: CatalogProduct; variant: CatalogVariant } | null {
  const pid = normalizeShopifyId(productId);
  const vid = normalizeShopifyId(variantId);
  if (!pid || !vid) return null;
  for (const product of products) {
    if (product.productId !== pid) continue;
    const variant = product.variants.find((v) => v.variantId === vid);
    if (variant) return { product, variant };
  }
  return null;
}

export type ScopeConflict = { dimension: "city" | "venue"; expected: string; found: string };

/**
 * Compare a live variant's structured scope against the session's authoritative
 * city / location. Returns conflicts only — a missing dimension is never a
 * conflict and a venue is never used to infer a city.
 */
export function scopeConflicts(
  variant: Pick<CatalogVariant, "city" | "venue">,
  session: { cityName?: string | null; locationName?: string | null },
): ScopeConflict[] {
  const out: ScopeConflict[] = [];
  const same = (a: string, b: string) => {
    const x = a.trim().toLowerCase();
    const y = b.trim().toLowerCase();
    return x === y || x.includes(y) || y.includes(x);
  };
  if (variant.city && session.cityName && !same(variant.city, session.cityName)) {
    out.push({ dimension: "city", expected: session.cityName, found: variant.city });
  }
  if (variant.venue && session.locationName && !same(variant.venue, session.locationName)) {
    out.push({ dimension: "venue", expected: session.locationName, found: variant.venue });
  }
  return out;
}

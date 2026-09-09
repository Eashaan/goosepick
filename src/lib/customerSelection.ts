/**
 * What the customer actually chose at checkout, for admin display only.
 *
 * Purely advisory: the session remains the authoritative city / venue / date,
 * and the host decides the final court or group placement. Nothing here is used
 * to place a player automatically.
 */
import {
  describeCatalogVariant,
  inferFromLegacyTitle,
  type CatalogProduct,
} from "../../supabase/functions/shopify-event-catalog/lib";
import { findCatalogVariant } from "@/hooks/useEventCatalog";

export interface CustomerSelectionSource {
  shopify_product_id?: string | null;
  shopify_variant_id?: string | null;
  line_item_title?: string | null;
  mapping?: { metadata?: unknown } | null;
}

const metadataLabel = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== "object") return null;
  const rec = metadata as Record<string, unknown>;
  for (const key of ["label", "variant_title"]) {
    const raw = rec[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
};

/**
 * Chips describing the checkout choice, e.g. `["Bandra", "Intermediate (<3.4)"]`
 * today and `["Mumbai", "Bandra", "Intermediate"]` with structured variants.
 * Returns an empty list when nothing is known.
 */
export function customerSelectionChips(
  row: CustomerSelectionSource,
  products: readonly CatalogProduct[] = [],
): string[] {
  const found = findCatalogVariant(products, row.shopify_product_id, row.shopify_variant_id);
  if (found) {
    const parts = [found.variant.city, found.variant.venue, found.variant.skill, found.variant.ticketType].filter(
      (p): p is string => Boolean(p),
    );
    if (parts.length > 0) return parts;
    return [describeCatalogVariant(found.variant)];
  }

  const title = row.line_item_title?.trim() || metadataLabel(row.mapping?.metadata);
  if (!title) return [];
  const legacy = inferFromLegacyTitle(title);
  const parts = [legacy.venue, legacy.skill, legacy.ticketType].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts : [title];
}

export const CUSTOMER_SKILL_ADVISORY =
  "Customer-selected skill is advisory. Host decides final court/group placement.";

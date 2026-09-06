/**
 * Browser-side view of the Shopify catalogue + occurrence-key helpers.
 *
 * The catalogue itself (product / variant ids, allowed shop domains, property
 * names) is the SAME module the Edge Function uses, so the admin panel and
 * the webhook can never disagree about ids. Nothing here calls Shopify.
 */
export * from "../../supabase/functions/_shared/shopify-catalog";

import {
  SESSION_KEY_PROPERTY_NAMES,
  normalizeShopifyId,
} from "../../supabase/functions/_shared/shopify-catalog";

/** The property name we tell the storefront to attach (hidden from customers). */
export const STOREFRONT_SESSION_KEY_PROPERTY = SESSION_KEY_PROPERTY_NAMES[0];

/** Unambiguous lowercase alphabet (no 0/o/1/l/i). */
const TOKEN_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function randomToken(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  return out;
}

/**
 * Stable, opaque key for ONE Goosepick session occurrence:
 * `gp_<first 8 hex of session uuid>_<6 random chars>`. Generated once per
 * session (reused for every variant row) and never derived from titles.
 */
export function generateOccurrenceKey(sessionId: string): string {
  const prefix = sessionId.replace(/-/g, "").slice(0, 8).toLowerCase() || randomToken(8);
  return `gp_${prefix}_${randomToken(6)}`;
}

/**
 * Per-row mapping_key: occurrence key + a variant suffix so each (occurrence,
 * variant) pair is unique while still recognisably belonging to the occurrence.
 */
export function buildMappingKey(occurrenceKey: string, variantId: string | null): string {
  const vid = normalizeShopifyId(variantId);
  return vid ? `${occurrenceKey}_v${vid.slice(-6)}` : `${occurrenceKey}_all`;
}

/** Human-readable reason for an unmapped seat (mirrors the webhook's reasons). */
export const UNMAPPED_REASON_LABEL: Record<string, string> = {
  no_session_key: "Storefront sent no session key",
  key_invalid: "Session key was malformed",
  key_unknown: "Session key doesn't match any active link",
  key_product_mismatch: "Session key belongs to a different product/variant",
  key_ambiguous: "Session key matches more than one link",
  date_invalid: "Session date was malformed",
  date_unmatched: "No link for that product on that date",
  date_ambiguous: "More than one link for that product on that date",
  mapping_has_no_session: "Link exists but has no session yet",
};

export function describeUnmappedReason(reason: string | null | undefined): string {
  if (!reason) return "Could not be matched to a session";
  return UNMAPPED_REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import type { ActiveSession } from "@/hooks/useActiveSession";
import {
  buildMappingKey,
  describeVariant,
  findEventProduct,
  findEventVariant,
  generateOccurrenceKey,
  normalizeShopifyId,
} from "@/lib/shopifyCatalog";

export const SHOPIFY_MAPPINGS_QUERY_KEY = "shopify_session_mappings";
export const UNMAPPED_REGISTRATIONS_QUERY_KEY = "unmapped_registrations";
export const WEBHOOK_ATTENTION_QUERY_KEY = "webhook_attention_events";

export type ShopifyMappingRow = Database["public"]["Tables"]["shopify_session_mappings"]["Row"];
type MappingInsert = Database["public"]["Tables"]["shopify_session_mappings"]["Insert"];

export interface UnmappedRegistrationRow {
  id: string;
  seat_index: number;
  status: string;
  created_at: string;
  mapping_id: string | null;
  participant_email: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  line_item_title: string | null;
  line_item_quantity: number | null;
  requested_session_key: string | null;
  unmapped_reason: string | null;
  commerce_order: { shopify_order_name: string | null; purchaser_email: string | null } | null;
}

export interface WebhookAttentionRow {
  id: string;
  topic: string;
  status: string;
  shopify_order_id: string | null;
  error: string | null;
  result: Json;
  created_at: string;
}

/** Mapping rows for ONE session (admin-only via RLS). */
export function useSessionMappings(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: [SHOPIFY_MAPPINGS_QUERY_KEY, sessionId],
    enabled: Boolean(sessionId),
    queryFn: async (): Promise<ShopifyMappingRow[]> => {
      const { data, error } = await supabase
        .from("shopify_session_mappings")
        .select("*")
        .eq("session_id", sessionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Paid seats the webhook could not attach to a session. Deliberately NOT
 * session-scoped — an unmapped seat has no session, so it must be visible
 * from any admin dashboard or it would silently disappear.
 */
export function useUnmappedRegistrations(enabled = true) {
  return useQuery({
    queryKey: [UNMAPPED_REGISTRATIONS_QUERY_KEY],
    enabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<UnmappedRegistrationRow[]> => {
      const { data, error } = await supabase
        .from("experience_registrations")
        .select(
          `id, seat_index, status, created_at, mapping_id, participant_email,
           shopify_product_id, shopify_variant_id, line_item_title, line_item_quantity,
           requested_session_key, unmapped_reason,
           commerce_order:commerce_orders ( shopify_order_name, purchaser_email )`,
        )
        .eq("status", "unmapped")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as UnmappedRegistrationRow[];
    },
  });
}

/** Webhook deliveries that need a human look (needs_review / error). */
export function useWebhookAttentionEvents(enabled = true) {
  return useQuery({
    queryKey: [WEBHOOK_ATTENTION_QUERY_KEY],
    enabled,
    refetchInterval: 60_000,
    queryFn: async (): Promise<WebhookAttentionRow[]> => {
      const { data, error } = await supabase
        .from("commerce_webhook_events")
        .select("id, topic, status, shopify_order_id, error, result, created_at")
        .in("status", ["needs_review", "error"])
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as WebhookAttentionRow[];
    },
  });
}

export interface VariantSelection {
  productId: string;
  /** null = every variant of the product */
  variantId: string | null;
}

export interface CreateMappingsInput {
  session: ActiveSession;
  selections: VariantSelection[];
  /** Existing occurrence key for this session, if any (reused, never regenerated). */
  occurrenceKey: string | null;
}

export interface CreateMappingsResult {
  created: number;
  skippedExisting: number;
  occurrenceKey: string;
}

const isUniqueViolation = (error: { code?: string } | null | undefined) => error?.code === "23505";

/** Create one mapping row per selected variant, all sharing the session's occurrence key. */
export async function createSessionMappings(input: CreateMappingsInput): Promise<CreateMappingsResult> {
  const occurrenceKey = input.occurrenceKey ?? generateOccurrenceKey(input.session.id);
  let created = 0;
  let skippedExisting = 0;

  for (const selection of input.selections) {
    const productId = normalizeShopifyId(selection.productId);
    if (!productId) throw new Error("Invalid Shopify product id");
    const variantId = normalizeShopifyId(selection.variantId);
    const product = findEventProduct(productId);
    const variant = variantId ? findEventVariant(productId, variantId)?.variant : undefined;

    const row: MappingInsert = {
      mapping_key: buildMappingKey(occurrenceKey, variantId),
      occurrence_key: occurrenceKey,
      shopify_product_id: productId,
      shopify_variant_id: variantId,
      city_id: input.session.city_id,
      event_type: input.session.event_type as Database["public"]["Enums"]["scope_event_type"],
      location_id: input.session.location_id ?? null,
      session_date: input.session.date,
      session_id: input.session.id,
      is_active: true,
      metadata: {
        product_title: product?.title ?? null,
        variant_title: variant?.title ?? null,
        label: describeVariant(productId, variantId),
        created_via: "admin_dashboard",
      },
    };

    const { error } = await supabase.from("shopify_session_mappings").insert(row);
    if (error) {
      if (isUniqueViolation(error)) {
        skippedExisting++;
        continue;
      }
      throw error;
    }
    created++;
  }

  return { created, skippedExisting, occurrenceKey };
}

export function useShopifyMappingMutations(sessionId: string | null | undefined) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [SHOPIFY_MAPPINGS_QUERY_KEY, sessionId] });
    queryClient.invalidateQueries({ queryKey: [UNMAPPED_REGISTRATIONS_QUERY_KEY] });
  };

  const create = useMutation({
    mutationFn: createSessionMappings,
    onSuccess: invalidate,
  });

  const setActive = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from("shopify_session_mappings")
        .update({ is_active: isActive })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shopify_session_mappings").delete().eq("id", id);
      if (error) {
        // FK from experience_registrations.mapping_id → seats already reference it.
        if (error.code === "23503") {
          throw new Error("Seats already reference this link. Turn it off instead of deleting it.");
        }
        throw error;
      }
    },
    onSuccess: invalidate,
  });

  const resolveUnmapped = useMutation({
    mutationFn: async ({ registrationId, mappingId }: { registrationId: string; mappingId: string }) => {
      const { data, error } = await supabase.rpc("admin_resolve_unmapped_registration", {
        p_registration_id: registrationId,
        p_mapping_id: mappingId,
      });
      if (error) throw error;
      const result = (data ?? {}) as { ok?: boolean; error?: string; status?: string };
      if (!result.ok) throw new Error(result.error ?? "Could not attach this seat");
      return result;
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["registration_pool"] });
    },
  });

  return { create, setActive, remove, resolveUnmapped };
}

/**
 * Pick the mapping on THIS session that an unmapped seat may be attached to:
 * same product, and either the exact variant or a product-level (all variants)
 * link. Returns null when the admin must add the variant first.
 */
export function findAttachableMapping(
  seat: Pick<UnmappedRegistrationRow, "shopify_product_id" | "shopify_variant_id">,
  mappings: readonly ShopifyMappingRow[],
): ShopifyMappingRow | null {
  const productId = normalizeShopifyId(seat.shopify_product_id);
  const variantId = normalizeShopifyId(seat.shopify_variant_id);
  if (!productId) return null;
  const candidates = mappings.filter(
    (m) => m.is_active && normalizeShopifyId(m.shopify_product_id) === productId,
  );
  const exact = candidates.find(
    (m) => variantId !== null && normalizeShopifyId(m.shopify_variant_id) === variantId,
  );
  if (exact) return exact;
  return candidates.find((m) => m.shopify_variant_id === null) ?? null;
}

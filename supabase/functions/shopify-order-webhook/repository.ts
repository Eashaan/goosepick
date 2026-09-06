/**
 * Supabase-backed WebhookRepository (service role). Deno-only — the pure
 * processing logic lives in ./lib.ts and is unit-tested with an in-memory
 * repository instead of this one.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { normalizeShopifyId, toProductGid } from "../_shared/shopify-catalog.ts";
import type {
  ClaimEventInput,
  ClaimResult,
  ExistingRegistration,
  FinalizeEventInput,
  MappingRow,
  OrderRow,
  OrderUpsert,
  ProfileRow,
  RegistrationInsert,
  WebhookRepository,
} from "./lib.ts";

/** A `processing` row older than this is treated as a crashed attempt and retried. */
const STALE_PROCESSING_MS = 5 * 60 * 1000;
const TERMINAL_LEDGER_STATUSES = new Set(["processed", "ignored", "needs_review"]);
const ORDER_COLUMNS = "id, shopify_order_id, financial_status, cancelled_at, purchaser_profile_id";
const REGISTRATION_COLUMNS =
  "id, commerce_order_id, shopify_line_item_id, seat_index, status, profile_id, participant_email";

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (m) => `\\${m}`);

const fail = (step: string, error: { message: string } | null): never => {
  throw new Error(`${step}: ${error?.message ?? "unknown error"}`);
};

export function createSupabaseWebhookRepository(client: SupabaseClient): WebhookRepository {
  const attachPlayers = async (
    rows: Array<Omit<ExistingRegistration, "has_player">>,
  ): Promise<ExistingRegistration[]> => {
    if (rows.length === 0) return [];
    const { data, error } = await client
      .from("players")
      .select("registration_id")
      .in(
        "registration_id",
        rows.map((r) => r.id),
      );
    if (error) fail("players lookup", error);
    const linked = new Set((data ?? []).map((p: { registration_id: string | null }) => p.registration_id));
    return rows.map((r) => ({ ...r, has_player: linked.has(r.id) }));
  };

  return {
    async claimEvent(input: ClaimEventInput): Promise<ClaimResult> {
      const { error } = await client
        .from("commerce_webhook_events")
        .insert({ ...input, status: "processing", attempt_count: 1 });
      if (!error) return { outcome: "claimed", attempt: 1 };
      if (error.code !== "23505") fail("ledger insert", error);

      const { data: existing, error: selectError } = await client
        .from("commerce_webhook_events")
        .select("id, status, attempt_count, updated_at")
        .eq("provider", input.provider)
        .eq("webhook_id", input.webhook_id)
        .maybeSingle();
      if (selectError) fail("ledger lookup", selectError);
      if (!existing) throw new Error("ledger lookup: row vanished after conflict");

      if (TERMINAL_LEDGER_STATUSES.has(existing.status)) {
        return { outcome: "duplicate", existingStatus: existing.status };
      }
      const ageMs = Date.now() - new Date(existing.updated_at).getTime();
      if (existing.status === "processing" && ageMs < STALE_PROCESSING_MS) {
        return { outcome: "in_progress" };
      }

      // Previous attempt errored or went stale: take the row over atomically.
      const attempt = (existing.attempt_count ?? 1) + 1;
      const { data: taken, error: takeError } = await client
        .from("commerce_webhook_events")
        .update({
          status: "processing",
          attempt_count: attempt,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("status", existing.status)
        .eq("attempt_count", existing.attempt_count)
        .select("id");
      if (takeError) fail("ledger retry", takeError);
      if (!taken || taken.length === 0) return { outcome: "in_progress" };
      return { outcome: "claimed", attempt };
    },

    async finalizeEvent(webhookId: string, patch: FinalizeEventInput): Promise<void> {
      const { error } = await client
        .from("commerce_webhook_events")
        .update({
          status: patch.status,
          result: patch.result,
          error: patch.error,
          shopify_order_id: patch.shopify_order_id,
          processed_at: new Date().toISOString(),
        })
        .eq("provider", "shopify")
        .eq("webhook_id", webhookId);
      if (error) fail("ledger finalize", error);
    },

    async findMappingsByKeys(keys: string[]): Promise<MappingRow[]> {
      if (keys.length === 0) return [];
      const select =
        "id, mapping_key, occurrence_key, shopify_product_id, shopify_variant_id, session_id, session_date, is_active";
      const [byMapping, byOccurrence] = await Promise.all([
        client.from("shopify_session_mappings").select(select).in("mapping_key", keys),
        client.from("shopify_session_mappings").select(select).in("occurrence_key", keys),
      ]);
      if (byMapping.error) fail("mapping key lookup", byMapping.error);
      if (byOccurrence.error) fail("occurrence key lookup", byOccurrence.error);
      const merged = new Map<string, MappingRow>();
      for (const row of [...(byMapping.data ?? []), ...(byOccurrence.data ?? [])] as MappingRow[]) {
        merged.set(row.id, row);
      }
      return Array.from(merged.values());
    },

    async findMappingsForProducts(productIds: string[]): Promise<MappingRow[]> {
      const ids = productIds
        .map((id) => normalizeShopifyId(id))
        .filter((id): id is string => id !== null);
      if (ids.length === 0) return [];
      // Mappings store numeric ids, but tolerate GIDs typed by hand.
      const candidates = ids.flatMap((id) => [id, toProductGid(id)]);
      const { data, error } = await client
        .from("shopify_session_mappings")
        .select(
          "id, mapping_key, occurrence_key, shopify_product_id, shopify_variant_id, session_id, session_date, is_active",
        )
        .in("shopify_product_id", candidates);
      if (error) fail("mapping product lookup", error);
      return (data ?? []) as MappingRow[];
    },

    async findProfileByEmail(email: string): Promise<ProfileRow | null> {
      const { data, error } = await client
        .from("participant_profiles")
        .select("id, email")
        .ilike("email", escapeLike(email))
        .limit(1)
        .maybeSingle();
      if (error) fail("profile lookup", error);
      return (data as ProfileRow | null) ?? null;
    },

    async getOrder(shopifyOrderId: string): Promise<OrderRow | null> {
      const { data, error } = await client
        .from("commerce_orders")
        .select(ORDER_COLUMNS)
        .eq("shopify_order_id", shopifyOrderId)
        .maybeSingle();
      if (error) fail("order lookup", error);
      return (data as OrderRow | null) ?? null;
    },

    async upsertOrder(order: OrderUpsert): Promise<OrderRow> {
      const { data, error } = await client
        .from("commerce_orders")
        .upsert(order, { onConflict: "shopify_order_id" })
        .select(ORDER_COLUMNS)
        .single();
      if (error || !data) fail("order upsert", error);
      return data as OrderRow;
    },

    async insertRegistrationsIgnoreDuplicates(rows: RegistrationInsert[]): Promise<number> {
      if (rows.length === 0) return 0;
      const { data, error } = await client
        .from("experience_registrations")
        .upsert(rows, { onConflict: "shopify_line_item_id,seat_index", ignoreDuplicates: true })
        .select("id");
      if (error) fail("registration insert", error);
      return data?.length ?? 0;
    },

    async listRegistrationsForOrder(commerceOrderId: string): Promise<ExistingRegistration[]> {
      const { data, error } = await client
        .from("experience_registrations")
        .select(REGISTRATION_COLUMNS)
        .eq("commerce_order_id", commerceOrderId)
        .order("shopify_line_item_id")
        .order("seat_index");
      if (error) fail("registrations by order", error);
      return attachPlayers((data ?? []) as Array<Omit<ExistingRegistration, "has_player">>);
    },

    async listRegistrationsForLineItems(lineItemIds: string[]): Promise<ExistingRegistration[]> {
      if (lineItemIds.length === 0) return [];
      const { data, error } = await client
        .from("experience_registrations")
        .select(REGISTRATION_COLUMNS)
        .in("shopify_line_item_id", lineItemIds)
        .order("shopify_line_item_id")
        .order("seat_index");
      if (error) fail("registrations by line item", error);
      return attachPlayers((data ?? []) as Array<Omit<ExistingRegistration, "has_player">>);
    },

    async updateRegistrationStatus(
      ids: string[],
      patch: { status: "cancelled" | "refunded"; at: string },
    ): Promise<number> {
      if (ids.length === 0) return 0;
      const update =
        patch.status === "cancelled"
          ? { status: "cancelled", cancelled_at: patch.at }
          : { status: "refunded", refunded_at: patch.at };
      const { data, error } = await client
        .from("experience_registrations")
        .update(update)
        .in("id", ids)
        .select("id");
      if (error) fail(`registration ${patch.status}`, error);
      return data?.length ?? 0;
    },

    async updateOrderAfterEvent(shopifyOrderId, patch): Promise<void> {
      const { error } = await client
        .from("commerce_orders")
        .update(patch)
        .eq("shopify_order_id", shopifyOrderId);
      if (error) fail("order update", error);
    },
  };
}

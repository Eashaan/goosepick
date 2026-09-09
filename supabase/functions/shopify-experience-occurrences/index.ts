/**
 * shopify-experience-occurrences — public, read-only occurrence feed.
 *
 * The Shopify product page calls this to show the real upcoming dates for a
 * Goosepick event product, and sends the chosen occurrence key back as a line
 * item property so the order webhook never has to guess a session.
 *
 * Deliberately public (verify_jwt = false, CORS *): it exposes only the
 * occurrence key, the event date, a display label and Shopify variant ids.
 * No writes, no PII, no session UUIDs, no mapping row ids.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { isKnownEventProduct, normalizeShopifyId } from "../_shared/shopify-catalog.ts";
import { buildPublicOccurrences, todayIso, type OccurrenceMappingRow } from "./lib.ts";

const SERVICE = "shopify-experience-occurrences";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=60",
    },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const url = new URL(req.url);
  const productId = normalizeShopifyId(url.searchParams.get("product_id"));
  if (!productId) {
    return json(400, { ok: false, error: "product_id is required (numeric Shopify product id)" });
  }
  if (!isKnownEventProduct(productId)) {
    return json(404, { ok: false, error: "Unknown product" });
  }
  const rawVariant = url.searchParams.get("variant_id");
  const variantId = normalizeShopifyId(rawVariant);
  if (rawVariant && !variantId) {
    return json(400, { ok: false, error: "variant_id must be a numeric Shopify variant id" });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const today = todayIso();
    const { data, error } = await supabase
      .from("shopify_session_mappings")
      .select(
        "occurrence_key, session_date, session_id, is_active, shopify_product_id, shopify_variant_id, metadata, session:sessions!inner ( status, date )",
      )
      .eq("is_active", true)
      .not("session_id", "is", null)
      .gte("session_date", today)
      .limit(500);

    if (error) {
      console.log(JSON.stringify({ fn: SERVICE, level: "error", code: error.code ?? null }));
      return json(503, { ok: false, error: "Occurrences temporarily unavailable" });
    }

    const occurrences = buildPublicOccurrences((data ?? []) as unknown as OccurrenceMappingRow[], {
      productId,
      variantId,
      today,
    });

    return json(200, {
      ok: true,
      product_id: productId,
      ...(variantId ? { variant_id: variantId } : {}),
      occurrences,
    });
  } catch (err) {
    console.log(JSON.stringify({ fn: SERVICE, level: "error", message: err instanceof Error ? err.message : "unknown" }));
    return json(500, { ok: false, error: "Unexpected error" });
  }
});

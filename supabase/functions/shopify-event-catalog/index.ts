/**
 * shopify-event-catalog — public, read-only Shopify product/variant feed.
 *
 * Lets Goosepick admin discover variants that were added in Shopify AFTER this
 * app was deployed (new cities, venues, skill bands, ticket tiers) without a
 * code deploy. Only the two known Goosepick event products are allowed — the
 * static catalogue stays the safety boundary.
 *
 * Reads the store's PUBLIC product JSON (`/products/<handle>.js`). No secrets,
 * no Shopify Admin API scopes, no PII, no database access, no writes.
 */
import {
  SHOPIFY_EVENT_PRODUCTS,
  SHOPIFY_STORE_MYSHOPIFY_DOMAIN,
  SHOPIFY_STORE_PRIMARY_DOMAIN,
  normalizeShopifyId,
} from "../_shared/shopify-catalog.ts";
import { normalizePublicProduct, type CatalogProduct, type ShopifyPublicProduct } from "./lib.ts";

const SERVICE = "shopify-event-catalog";

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
      "Cache-Control": "public, max-age=300",
    },
  });

const HOSTS = [SHOPIFY_STORE_PRIMARY_DOMAIN, SHOPIFY_STORE_MYSHOPIFY_DOMAIN];

async function fetchPublicProduct(handle: string): Promise<ShopifyPublicProduct | null> {
  for (const host of HOSTS) {
    try {
      const res = await fetch(`https://${host}/products/${handle}.js`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) continue;
      const body = (await res.json()) as ShopifyPublicProduct;
      if (body && typeof body === "object") return body;
    } catch {
      // try the next host
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  const url = new URL(req.url);
  const rawProduct = url.searchParams.get("product_id");
  const rawHandle = url.searchParams.get("handle");
  const eventType = url.searchParams.get("event_type");

  let wanted = [...SHOPIFY_EVENT_PRODUCTS];
  if (rawProduct) {
    const id = normalizeShopifyId(rawProduct);
    wanted = wanted.filter((p) => p.productId === id);
  }
  if (rawHandle) {
    const handle = rawHandle.trim().toLowerCase();
    wanted = wanted.filter((p) => p.handle.toLowerCase() === handle);
  }
  if (eventType) {
    wanted = wanted.filter((p) => p.eventType === eventType);
  }
  if (wanted.length === 0) {
    return json(404, { ok: false, error: "Unknown product" });
  }

  try {
    const results = await Promise.all(
      wanted.map(async (known) => ({ known, raw: await fetchPublicProduct(known.handle) })),
    );

    const products: CatalogProduct[] = [];
    const unavailable: string[] = [];
    for (const { known, raw } of results) {
      if (!raw) {
        unavailable.push(known.handle);
        continue;
      }
      products.push(
        normalizePublicProduct(raw, {
          productId: known.productId,
          handle: known.handle,
          eventType: known.eventType,
          title: known.title,
        }),
      );
    }

    if (products.length === 0) {
      return json(503, { ok: false, error: "Shopify catalogue temporarily unavailable", unavailable });
    }

    return json(200, {
      ok: true,
      products,
      ...(unavailable.length > 0 ? { unavailable } : {}),
    });
  } catch (err) {
    console.log(
      JSON.stringify({ fn: SERVICE, level: "error", message: err instanceof Error ? err.message : "unknown" }),
    );
    return json(500, { ok: false, error: "Unexpected error" });
  }
});

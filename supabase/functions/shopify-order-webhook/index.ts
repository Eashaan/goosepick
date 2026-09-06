/**
 * shopify-order-webhook — Shopify → Goosepick registrations.
 *
 * Topics: orders/paid, orders/cancelled, refunds/create (one endpoint,
 * branches on X-Shopify-Topic). Security posture:
 *
 *   1. FAIL CLOSED: without SHOPIFY_WEBHOOK_SECRET every request is 503.
 *   2. HMAC-SHA256 over the RAW body must match X-Shopify-Hmac-Sha256
 *      (constant-time compare) or the request is 401.
 *   3. X-Shopify-Shop-Domain must be on the allowlist
 *      (SHOPIFY_ALLOWED_SHOP_DOMAINS, default: the Goosepick store) or 401.
 *   4. X-Shopify-Webhook-Id is the idempotency key (event ledger); duplicate
 *      deliveries return 200 without re-processing.
 *
 * Responses: 200 processed / ignored / needs_review / duplicate,
 *            4xx auth or malformed request, 5xx retriable (Shopify retries).
 * Logs are structured JSON without PII or secrets.
 *
 * Deployed with verify_jwt = false (Shopify cannot send a Supabase JWT); the
 * HMAC above is the authentication.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_ALLOWED_SHOP_DOMAINS, isAllowedShopDomain } from "../_shared/shopify-catalog.ts";
import { processShopifyWebhook, sha256Hex, verifyShopifyHmac } from "./lib.ts";
import { createSupabaseWebhookRepository } from "./repository.ts";

const SERVICE = "shopify-order-webhook";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const log = (entry: Record<string, unknown>) => {
  console.log(JSON.stringify({ fn: SERVICE, at: new Date().toISOString(), ...entry }));
};

const parseAllowedDomains = (raw: string | undefined): readonly string[] => {
  const configured = (raw ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_ALLOWED_SHOP_DOMAINS;
};

Deno.serve(async (req) => {
  if (req.method === "GET" || req.method === "HEAD") {
    // Deployment probe only — reveals nothing about configuration.
    return json(200, { ok: true, service: SERVICE, accepts: ["POST"] });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const secret = Deno.env.get("SHOPIFY_WEBHOOK_SECRET")?.trim();
    if (!secret) {
      log({ level: "error", outcome: "not_configured", reason: "SHOPIFY_WEBHOOK_SECRET missing" });
      return json(503, { ok: false, error: "Webhook receiver is not configured" });
    }

    const raw = new Uint8Array(await req.arrayBuffer());
    const hmacHeader = req.headers.get("x-shopify-hmac-sha256");
    const verified = await verifyShopifyHmac(raw, hmacHeader, secret);
    if (!verified) {
      log({ level: "warn", outcome: "rejected", reason: hmacHeader ? "hmac_mismatch" : "hmac_missing" });
      return json(401, { ok: false, error: "Invalid signature" });
    }

    const shopDomain = req.headers.get("x-shopify-shop-domain");
    const allowed = parseAllowedDomains(Deno.env.get("SHOPIFY_ALLOWED_SHOP_DOMAINS"));
    if (!isAllowedShopDomain(shopDomain, allowed)) {
      log({ level: "warn", outcome: "rejected", reason: "shop_not_allowed", shop_domain: shopDomain });
      return json(401, { ok: false, error: "Shop not allowed" });
    }

    const topic = req.headers.get("x-shopify-topic")?.trim() ?? "";
    const webhookId = req.headers.get("x-shopify-webhook-id")?.trim() ?? "";
    if (!topic || !webhookId) {
      log({ level: "warn", outcome: "rejected", reason: "missing_headers" });
      return json(400, { ok: false, error: "Missing X-Shopify-Topic or X-Shopify-Webhook-Id" });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch {
      log({ level: "warn", outcome: "rejected", reason: "invalid_json", topic, webhook_id: webhookId });
      return json(400, { ok: false, error: "Body is not valid JSON" });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return json(400, { ok: false, error: "Body must be a JSON object" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const repo = createSupabaseWebhookRepository(supabase);

    const outcome = await processShopifyWebhook(
      repo,
      {
        webhookId,
        topic,
        shopDomain,
        eventId: req.headers.get("x-shopify-event-id"),
        apiVersion: req.headers.get("x-shopify-api-version"),
        triggeredAt: req.headers.get("x-shopify-triggered-at"),
        payloadHash: await sha256Hex(raw),
        payload,
      },
      { log: (entry) => log({ level: "info", ...entry }) },
    );

    return json(outcome.httpStatus, outcome.body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log({ level: "error", outcome: "unhandled", error: message.slice(0, 500) });
    return json(500, { ok: false, error: "Internal error" });
  }
});

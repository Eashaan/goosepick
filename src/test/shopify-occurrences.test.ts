// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPublicOccurrences,
  todayIso,
  type OccurrenceMappingRow,
} from "../../supabase/functions/shopify-experience-occurrences/lib.ts";
import { SHOPIFY_EVENT_PRODUCTS } from "../../supabase/functions/_shared/shopify-catalog.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const SOCIAL = SHOPIFY_EVENT_PRODUCTS.find((p) => p.eventType === "social")!;
const TODAY = "2026-09-09";
const FUTURE = "2026-10-01";
const LATER = "2026-11-01";
const PAST = "2026-01-01";

const row = (over: Partial<OccurrenceMappingRow> = {}): OccurrenceMappingRow => ({
  occurrence_key: "gp_aaaaaaaa_abc123",
  session_date: FUTURE,
  session_id: "11111111-1111-1111-1111-111111111111",
  is_active: true,
  shopify_product_id: SOCIAL.productId,
  shopify_variant_id: SOCIAL.variants[0].variantId,
  metadata: { label: "Goosepick Social — Early Bird" },
  session: { status: "draft", date: FUTURE },
  ...over,
});

describe("public occurrence feed contract", () => {
  it("groups mappings by occurrence key and exposes only public fields", () => {
    const out = buildPublicOccurrences(
      [
        row(),
        row({ shopify_variant_id: SOCIAL.variants[1].variantId }),
      ],
      { productId: SOCIAL.productId, today: TODAY },
    );
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]).sort()).toEqual([
      "all_variants",
      "capacity",
      "date",
      "key",
      "label",
      "remaining",
      "sold_out",
      "variant_ids",
    ]);
    expect(out[0].variant_ids.sort()).toEqual(
      [SOCIAL.variants[0].variantId, SOCIAL.variants[1].variantId].sort(),
    );
    expect(out[0].all_variants).toBe(false);
    expect(JSON.stringify(out)).not.toContain("11111111");
  });

  it("excludes inactive, session-less, ended, missing-session and past rows", () => {
    const rows = [
      row({ is_active: false }),
      row({ occurrence_key: "gp_b_2", session_id: null }),
      row({ occurrence_key: "gp_c_3", session: { status: "ended", date: FUTURE } }),
      row({ occurrence_key: "gp_d_4", session: null }),
      row({ occurrence_key: "gp_e_5", session_date: PAST, session: { status: "draft", date: PAST } }),
    ];
    expect(buildPublicOccurrences(rows, { productId: SOCIAL.productId, today: TODAY })).toEqual([]);
  });

  it("keeps today's session and live sessions", () => {
    const out = buildPublicOccurrences(
      [row({ session_date: TODAY, session: { status: "live", date: TODAY } })],
      { productId: SOCIAL.productId, today: TODAY },
    );
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe(TODAY);
  });

  it("sorts ascending by date", () => {
    const out = buildPublicOccurrences(
      [
        row({ occurrence_key: "gp_late_1", session_date: LATER, session: { status: "draft", date: LATER } }),
        row({ occurrence_key: "gp_soon_1" }),
      ],
      { productId: SOCIAL.productId, today: TODAY },
    );
    expect(out.map((o) => o.date)).toEqual([FUTURE, LATER]);
  });

  it("filters to the requested variant but keeps product-level mappings", () => {
    const out = buildPublicOccurrences(
      [
        row({ occurrence_key: "gp_v1_1", shopify_variant_id: SOCIAL.variants[0].variantId }),
        row({ occurrence_key: "gp_v2_2", shopify_variant_id: SOCIAL.variants[1].variantId }),
        row({ occurrence_key: "gp_all_3", shopify_variant_id: null }),
      ],
      { productId: SOCIAL.productId, variantId: SOCIAL.variants[0].variantId, today: TODAY },
    );
    expect(out.map((o) => o.key).sort()).toEqual(["gp_all_3", "gp_v1_1"]);
    expect(out.find((o) => o.key === "gp_all_3")!.all_variants).toBe(true);
  });

  it("ignores other products", () => {
    expect(
      buildPublicOccurrences([row({ shopify_product_id: "9999999999" })], {
        productId: SOCIAL.productId,
        today: TODAY,
      }),
    ).toEqual([]);
  });

  it("todayIso returns an ISO date", () => {
    expect(todayIso(new Date("2026-09-09T18:00:00Z"))).toBe("2026-09-09");
  });
});

describe("occurrence endpoint source guards", () => {
  const source = read("supabase/functions/shopify-experience-occurrences/index.ts");

  it("is read-only, public and product-gated", () => {
    expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(source).toContain("isKnownEventProduct");
    expect(source).toContain('"Access-Control-Allow-Origin": "*"');
    expect(source).toContain("Method not allowed");
  });

  it("never selects PII columns", () => {
    for (const forbidden of ["participant_email", "purchaser_email", "participant_profiles", "commerce_orders", "phone"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("is registered with verify_jwt = false", () => {
    expect(read("supabase/config.toml")).toMatch(
      /\[functions\.shopify-experience-occurrences\]\s*\nverify_jwt = false/,
    );
  });
});

describe("admin date scheduling", () => {
  it("panel only allows editing on a draft and calls the RPC", () => {
    const panel = read("src/components/admin/ShopifyMappingPanel.tsx");
    expect(panel).toContain('session.status === "draft"');
    expect(panel).toContain("setSessionDate.mutateAsync");
    expect(panel).toContain("the date is locked once the session starts");
    const hook = read("src/hooks/useShopifyMappings.ts");
    expect(hook).toContain("admin_set_shopify_session_date");
    expect(hook).toContain('queryKey: ["active_session"]');
  });
});

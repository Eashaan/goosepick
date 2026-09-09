// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  inferFromLegacyTitle,
  normalizePublicProduct,
  describeCatalogVariant,
} from "../../supabase/functions/shopify-event-catalog/lib";
import { planRefund } from "../../supabase/functions/shopify-order-webhook/lib";

describe("live Shopify catalogue normalisation", () => {
  it("reads future structured options (City / Venue / Skill) without a deploy", () => {
    const product = normalizePublicProduct(
      {
        id: 8915933724862,
        handle: "goosepick-thursdays",
        title: "Goosepick Thursdays",
        options: [
          { name: "City", position: 1 },
          { name: "Venue", position: 2 },
          { name: "Skill", position: 3 },
        ],
        variants: [
          {
            id: 991,
            title: "Delhi / Vasant Kunj / Intermediate",
            available: true,
            option1: "Delhi",
            option2: "Vasant Kunj",
            option3: "Intermediate",
          },
        ],
      },
      { productId: "8915933724862", eventType: "thursdays", handle: "goosepick-thursdays" },
    );

    expect(product.structuredDimensions).toEqual(expect.arrayContaining(["city", "venue", "skill"]));
    const variant = product.variants[0];
    expect(variant.city).toBe("Delhi");
    expect(variant.venue).toBe("Vasant Kunj");
    expect(variant.skill).toBe("Intermediate");
    expect(describeCatalogVariant(variant)).toBe("Delhi · Vasant Kunj · Intermediate");
  });

  it("falls back to today's Thursday titles and never invents a city", () => {
    const legacy = inferFromLegacyTitle("Bandra / Intermediate (<3.4)");
    expect(legacy.venue).toBe("Bandra");
    expect(legacy.skill).toBe("Intermediate (<3.4)");
    expect(legacy.city ?? null).toBeNull();
  });
});

describe("refund planning never touches courts, groups or rotations", () => {
  const seat = (id: string, over: Partial<Parameters<typeof planRefund>[0]["seats"][number]> = {}) =>
    ({
      id,
      shopify_line_item_id: "line-1",
      seat_index: Number(id.slice(-1)),
      status: "confirmed",
      profile_id: null,
      hasPlayer: false,
      ...over,
    }) as Parameters<typeof planRefund>[0]["seats"][number];

  it("refunding one of six independent single-seat line items affects only that seat", () => {
    const seats = [1, 2, 3, 4, 5, 6].map((n) =>
      seat(`seat-${n}`, { shopify_line_item_id: `line-${n}`, seat_index: 1, hasPlayer: true }),
    );
    const plan = planRefund({ seats, refundLineItems: [{ lineItemId: "line-3", quantity: 1 }] });

    expect(plan.registrationIds).toEqual(["seat-3"]);
    expect(plan.ambiguousLineItems).toEqual([]);
    expect(plan.refundedWithPlayers).toBe(1);
  });

  it("a quantity-6 line item with all six seats rostered refunds nothing and needs review", () => {
    const seats = [1, 2, 3, 4, 5, 6].map((n) => seat(`seat-${n}`, { seat_index: n, hasPlayer: true }));
    const plan = planRefund({ seats, refundLineItems: [{ lineItemId: "line-1", quantity: 1 }] });

    expect(plan.registrationIds).toEqual([]);
    expect(plan.ambiguousLineItems).toEqual(["line-1"]);
    expect(plan.refundedWithPlayers).toBe(0);
  });
});

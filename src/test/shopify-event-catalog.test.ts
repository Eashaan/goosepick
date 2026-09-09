// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  inferFromLegacyTitle,
  normalizePublicProduct,
  describeCatalogVariant,
} from "../../supabase/functions/shopify-event-catalog/lib";
import { planRefund, type ExistingRegistration } from "../../supabase/functions/shopify-order-webhook/lib";

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
      {
        productId: "8915933724862",
        handle: "goosepick-thursdays",
        title: "Goosepick Thursdays",
        eventType: "thursdays",
      },
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
    expect(Object.keys(legacy)).not.toContain("city");

    const product = normalizePublicProduct(
      {
        id: 8915933724862,
        options: ["Title"],
        variants: [{ id: 48787061964990, title: "Bandra / Intermediate (<3.4)", available: true, option1: "Bandra / Intermediate (<3.4)" }],
      },
      {
        productId: "8915933724862",
        handle: "goosepick-thursdays",
        title: "Goosepick Thursdays",
        eventType: "thursdays",
      },
    );
    const variant = product.variants[0];
    expect(variant.venue).toBe("Bandra");
    expect(variant.skill).toBe("Intermediate (<3.4)");
    expect(variant.city).toBeNull();
  });
});

describe("refund planning never touches courts, groups or rotations", () => {
  const seat = (id: string, over: Partial<ExistingRegistration> = {}): ExistingRegistration => ({
    id,
    commerce_order_id: "order-1",
    shopify_line_item_id: "line-1",
    seat_index: 1,
    status: "confirmed",
    profile_id: "prof-1",
    participant_email: "seat@example.com",
    has_player: true,
    ...over,
  });

  it("refunding one of six independent single-seat line items affects only that seat", () => {
    const seats = [1, 2, 3, 4, 5, 6].map((n) => seat(`seat-${n}`, { shopify_line_item_id: `line-${n}` }));
    const plan = planRefund(
      { id: 1, order_id: 2, refund_line_items: [{ line_item_id: "line-3", quantity: 1 }] },
      seats,
    );

    expect(plan.refundIds).toEqual(["seat-3"]);
    expect(plan.ambiguousLineItems).toEqual([]);
    expect(plan.refundedWithPlayers).toBe(1);
  });

  it("a quantity-1 refund on one six-seat line item with all seats rostered refunds nothing and needs review", () => {
    const seats = [1, 2, 3, 4, 5, 6].map((n) => seat(`seat-${n}`, { seat_index: n }));
    const plan = planRefund(
      { id: 1, order_id: 2, refund_line_items: [{ line_item_id: "line-1", quantity: 1 }] },
      seats,
    );

    expect(plan.refundIds).toEqual([]);
    expect(plan.ambiguousLineItems).toEqual(["line-1"]);
    expect(plan.refundedWithPlayers).toBe(0);
  });
});

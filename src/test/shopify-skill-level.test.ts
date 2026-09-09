// @vitest-environment node
/**
 * City + Locality refactor readiness: the skill level moves from the Shopify
 * variant to a checkout line-item property, stays advisory, and never places a
 * player on a court or group.
 */
import { describe, expect, it } from "vitest";
import {
  classifyLineItems,
  planSeatRows,
  resolveSelectedSkillLevel,
  type MappingResolution,
  type ShopifyOrderPayload,
} from "../../supabase/functions/shopify-order-webhook/lib";
import { SKILL_LEVEL_PROPERTY_NAMES } from "../../supabase/functions/_shared/shopify-catalog";
import {
  normalizePublicProduct,
  dimensionForOptionName,
} from "../../supabase/functions/shopify-event-catalog/lib";
import { customerSelectedSkill, customerSelectionChips } from "@/lib/customerSelection";

const THURSDAYS = "8915933724862";

const order = (item: Record<string, unknown>): ShopifyOrderPayload => ({
  id: 1,
  line_items: [{ id: "line-1", product_id: THURSDAYS, quantity: 1, ...item }] as never,
});

const seatRows = (payload: ShopifyOrderPayload) => {
  const { eventItems } = classifyLineItems(payload, new Set([THURSDAYS]));
  const resolutions = new Map<string, MappingResolution>(
    eventItems.map((i) => [
      i.lineItemId,
      { mapping: { id: "map-1" } as never, sessionId: "session-1", reason: null },
    ]),
  );
  return planSeatRows({
    commerceOrderId: "order-1",
    eventItems,
    resolutions,
    purchaser: { email: "buyer@example.com", phone: null, name: "Buyer" },
    purchaserProfile: null,
    terminal: null,
    terminalAt: null,
  });
};

describe("canonical skill line-item property", () => {
  it("uses _goosepick_skill_level as the canonical key with a non-underscore fallback", () => {
    expect(SKILL_LEVEL_PROPERTY_NAMES[0]).toBe("_goosepick_skill_level");
    expect(SKILL_LEVEL_PROPERTY_NAMES).toContain("goosepick_skill_level");
  });

  it("persists the property on the registration for a City + Locality variant", () => {
    const rows = seatRows(
      order({
        variant_id: "50000000000001",
        variant_title: "Mumbai / Bandra",
        properties: [
          { name: "_goosepick_skill_level", value: "Intermediate (<3.4)" },
          { name: "_goosepick_session_key", value: "gp_abc_123456" },
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].selected_skill_level).toBe("Intermediate (<3.4)");
  });

  it("falls back to the legacy variant's recorded skill when no property is sent", () => {
    const rows = seatRows(order({ variant_id: "48787061964990", variant_title: "Bandra / Intermediate (<3.4)" }));
    expect(rows[0].selected_skill_level).toBe("Intermediate (<3.4)");
  });

  it("never guesses a skill from an unknown City / Locality variant title", () => {
    const rows = seatRows(order({ variant_id: "50000000000001", variant_title: "Mumbai / Bandra" }));
    expect(rows[0].selected_skill_level).toBeNull();
  });

  it("applies one line-item property to every seat when quantity > 1", () => {
    const rows = seatRows(
      order({
        quantity: 3,
        variant_id: "50000000000001",
        properties: { goosepick_skill_level: "Beginner", _goosepick_session_key: "gp_abc_123456" },
      }),
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.seat_index)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.selected_skill_level === "Beginner")).toBe(true);
  });

  it("carries no court, group or roster placement of any kind", () => {
    const rows = seatRows(
      order({ variant_id: "50000000000001", properties: [{ name: "_goosepick_skill_level", value: "Advanced (>3.8)" }] }),
    );
    expect(Object.keys(rows[0]).some((k) => /court|group|player/i.test(k))).toBe(false);
  });

  it("reads an order-level note attribute when the line item has none", () => {
    expect(
      resolveSelectedSkillLevel({ id: "line-9", product_id: "999", variant_id: "999" }, "Beginner+ (<3.0)"),
    ).toBe("Beginner+ (<3.0)");
  });
});

describe("City + Locality catalogue normalisation", () => {
  it("recognises City and Locality option names explicitly", () => {
    expect(dimensionForOptionName("City")).toBe("city");
    expect(dimensionForOptionName("Locality")).toBe("venue");
    expect(dimensionForOptionName("Location")).toBe("venue");
  });

  it("normalises a skill-free City + Locality variant", () => {
    const product = normalizePublicProduct(
      {
        id: Number(THURSDAYS),
        options: [
          { name: "City", position: 1 },
          { name: "Locality", position: 2 },
        ],
        variants: [
          { id: 50000000000001, title: "Mumbai / Bandra", available: true, option1: "Mumbai", option2: "Bandra" },
        ],
      },
      { productId: THURSDAYS, handle: "goosepick-thursdays", title: "Goosepick Thursdays", eventType: "thursdays" },
    );

    expect(product.structuredDimensions).toEqual(["city", "venue"]);
    const variant = product.variants[0];
    expect(variant.city).toBe("Mumbai");
    expect(variant.venue).toBe("Bandra");
    expect(variant.skill).toBeNull();
  });
});

describe("admin display of the customer's skill choice", () => {
  it("prefers the stored column over any variant snapshot", () => {
    expect(
      customerSelectedSkill({
        selected_skill_level: "Advanced (>3.8)",
        line_item_title: "Goosepick Thursdays — Bandra / Beginner",
      }),
    ).toBe("Advanced (>3.8)");
  });

  it("falls back to the legacy title for older registrations", () => {
    expect(customerSelectedSkill({ line_item_title: "Bandra / Intermediate (<3.4)" })).toBe("Intermediate (<3.4)");
    expect(customerSelectionChips({ line_item_title: "Bandra / Intermediate (<3.4)" })).toEqual([
      "Bandra",
      "Intermediate (<3.4)",
    ]);
  });

  it("returns null when nothing is known", () => {
    expect(customerSelectedSkill({})).toBeNull();
  });
});

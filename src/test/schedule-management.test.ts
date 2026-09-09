// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildPublicOccurrences,
  type OccurrenceMappingRow,
} from "../../supabase/functions/shopify-experience-occurrences/lib.ts";
import {
  resolveSessionTargetEvent,
  sessionEventFilterType,
} from "../../src/hooks/useSchedules";
import { SHOPIFY_EVENT_PRODUCTS } from "../../supabase/functions/_shared/shopify-catalog.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const THURSDAYS = SHOPIFY_EVENT_PRODUCTS.find((p) => p.eventType === "thursdays")!;
const TODAY = "2026-09-10";
const DATE = "2026-09-17";
const SESSION = "cddaa336-a8b1-4c9a-930e-9dc5c1b818e9";

const row = (over: Partial<OccurrenceMappingRow> = {}): OccurrenceMappingRow => ({
  occurrence_key: "gp_cddaa336_20bf6c",
  session_date: DATE,
  session_id: SESSION,
  is_active: true,
  shopify_product_id: THURSDAYS.productId,
  shopify_variant_id: THURSDAYS.variants[0].variantId,
  metadata: {},
  session: { status: "draft", date: DATE, capacity: null },
  ...over,
});

describe("public occurrence capacity", () => {
  it("reports no limit when the session has no capacity", () => {
    const [out] = buildPublicOccurrences([row()], {
      productId: THURSDAYS.productId,
      today: TODAY,
    });
    expect(out.capacity).toBeNull();
    expect(out.remaining).toBeNull();
    expect(out.sold_out).toBe(false);
  });

  it("derives remaining seats from booked registrations", () => {
    const [out] = buildPublicOccurrences([row({ session: { status: "draft", date: DATE, capacity: 16 } })], {
      productId: THURSDAYS.productId,
      today: TODAY,
      bookedBySession: { [SESSION]: 5 },
    });
    expect(out.capacity).toBe(16);
    expect(out.remaining).toBe(11);
    expect(out.sold_out).toBe(false);
  });

  it("marks a full date sold out and never returns negative seats", () => {
    const [out] = buildPublicOccurrences([row({ session: { status: "draft", date: DATE, capacity: 16 } })], {
      productId: THURSDAYS.productId,
      today: TODAY,
      bookedBySession: { [SESSION]: 19 },
    });
    expect(out.remaining).toBe(0);
    expect(out.sold_out).toBe(true);
  });

  it("still exposes no session ids", () => {
    const out = buildPublicOccurrences([row({ session: { status: "draft", date: DATE, capacity: 16 } })], {
      productId: THURSDAYS.productId,
      today: TODAY,
      bookedBySession: { [SESSION]: 1 },
    });
    expect(JSON.stringify(out)).not.toContain(SESSION);
  });
});

describe("scheduling never starts scoring", () => {
  const hook = read("src/hooks/useSchedules.ts");
  const page = read("src/pages/admin/AdminSchedule.tsx");

  it("only writes through admin RPCs", () => {
    for (const rpc of [
      "admin_reconcile_recurring_schedules",
      "admin_set_recurring_schedule_active",
      "admin_skip_recurring_date",
      "admin_unskip_recurring_date",
      "admin_set_session_capacity",
      "admin_create_social_occurrence",
    ]) {
      expect(hook).toContain(rpc);
    }
    expect(hook).not.toMatch(/\.from\("sessions"\)[\s\S]{0,80}\.(update|insert|upsert|delete)\(/);
  });

  it("never sets live/started state from the schedule screen", () => {
    for (const forbidden of ['status: "live"', "started_at", "is_active: true"]) {
      expect(hook).not.toContain(forbidden);
      expect(page).not.toContain(forbidden);
    }
  });

  it("resolves the nearest upcoming draft rather than the newest created", () => {
    const resolver = read("src/hooks/useActiveSession.tsx");
    expect(resolver).toContain('.eq("status", "draft")');
    expect(resolver).toContain('.gte("date", todayIso)');
    expect(resolver).toContain('.order("date", { ascending: true })');
  });

  it("warns before starting a session dated in the future", () => {
    const controls = read("src/components/admin/SessionLifecycleControls.tsx");
    expect(controls).toContain("isFutureDate");
    expect(controls).toContain("Start anyway");
  });
});

describe("paid seats are never rejected by capacity", () => {
  const lib = read("supabase/functions/shopify-order-webhook/lib.ts");

  it("flags an overrun for review instead of failing the order", () => {
    expect(lib).toContain("capacity_overruns");
    expect(lib).toContain("overCapacity");
    expect(lib).toMatch(/needsReview =[\s\S]{0,120}overCapacity/);
  });

  it("treats the capacity lookup as optional and non-fatal", () => {
    expect(lib).toContain("sessionCapacityStatus?");
    expect(lib).toContain('result.capacity_check = "unavailable"');
  });
});

describe("cross-city session opening", () => {
  it("maps session event types to the events table filter", () => {
    expect(sessionEventFilterType({ event_type: "thursdays" })).toBe("recurring");
    expect(sessionEventFilterType({ event_type: "social" })).toBe("one_off");
  });

  it("resolves exactly one usable event row", () => {
    expect(
      resolveSessionTargetEvent({ event_type: "thursdays" }, [{ id: "evt-1" }]),
    ).toEqual({ eventId: "evt-1" });
  });

  it("surfaces missing or ambiguous events instead of guessing", () => {
    expect(resolveSessionTargetEvent({ event_type: "social" }, [])).toEqual({ error: "none" });
    expect(
      resolveSessionTargetEvent({ event_type: "thursdays" }, [{ id: "a" }, { id: "b" }]),
    ).toEqual({ error: "ambiguous" });
  });

  it("queries events by the session's own city, not the context list", () => {
    const page = read("src/pages/admin/AdminSchedule.tsx");
    expect(page).toContain('.eq("city_id", session.city_id)');
    expect(page).toContain("sessionEventFilterType(session)");
    expect(page).not.toContain("events.find(");
  });
});

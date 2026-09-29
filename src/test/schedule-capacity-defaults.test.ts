import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { planScheduleCapacityApply } from "@/hooks/useSchedules";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const S = "sched-1";
const base = {
  status: "draft" as const,
  is_active: false,
  capacity: null as number | null,
  capacity_source: "inherited" as string | null,
  booked: 0,
  recurring_schedule_id: S,
};

describe("recurring default capacity", () => {
  it("bulk apply updates future draft recurring sessions only", () => {
    const r = planScheduleCapacityApply(
      20,
      [
        { ...base, id: "a", date: "2026-10-01" },
        { ...base, id: "past", date: "2026-09-01" },
        { ...base, id: "live", date: "2026-10-08", status: "live", is_active: true },
        { ...base, id: "ended", date: "2026-10-15", status: "ended" },
        { ...base, id: "other", date: "2026-10-01", recurring_schedule_id: "x" },
      ],
      S,
      "2026-09-29",
    );
    expect(r.updated).toEqual(["a"]);
  });

  it("skips manual overrides unless explicitly included", () => {
    const rows = [{ ...base, id: "m", date: "2026-10-01", capacity: 16, capacity_source: "manual" }];
    expect(planScheduleCapacityApply(20, rows, S, "2026-09-29").skipped).toEqual(["m"]);
    expect(planScheduleCapacityApply(20, rows, S, "2026-09-29", true).updated).toEqual(["m"]);
  });

  it("blocks targets where the cap is below active bookings", () => {
    const r = planScheduleCapacityApply(5, [{ ...base, id: "b", date: "2026-10-01", booked: 7 }], S, "2026-09-29");
    expect(r.conflicts).toEqual([{ id: "b", date: "2026-10-01", booked: 7 }]);
    expect(r.updated).toEqual([]);
  });

  it("clearing the default via explicit apply is always safe", () => {
    const r = planScheduleCapacityApply(null, [{ ...base, id: "c", date: "2026-10-01", capacity: 20, booked: 30 }], S, "2026-09-29");
    expect(r.updated).toEqual(["c"]);
    expect(r.conflicts).toEqual([]);
  });

  it("NULL default with NULL inherited capacity is a no-op", () => {
    const r = planScheduleCapacityApply(null, [{ ...base, id: "n", date: "2026-10-01" }], S, "2026-09-29");
    expect(r.skipped).toEqual(["n"]);
  });

  it("wires the admin RPCs and UI copy without touching roster/commerce", () => {
    const hook = read("src/hooks/useSchedules.ts");
    expect(hook).toContain("admin_set_schedule_default_capacity");
    expect(hook).toContain("admin_apply_schedule_capacity");
    const page = read("src/pages/admin/AdminSchedule.tsx");
    expect(page).toContain("New Thursdays inherit this capacity");
    expect(page).toContain("Apply to upcoming dates");
    const block = hook.slice(hook.indexOf("const applyDefaultCapacity"), hook.indexOf("const createSocial"));
    expect(block).not.toMatch(/players|experience_registrations|commerce_orders|matches/);
  });

  it("Social creation still passes its own explicit capacity", () => {
    const hook = read("src/hooks/useSchedules.ts");
    expect(hook).toContain("admin_create_social_occurrence");
    expect(hook).toContain("p_capacity: (vars.capacity ?? undefined)");
  });
});

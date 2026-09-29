import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { can, highestRole, wouldRemoveLastOwner, adminEntryDestination, STAFF_ROLES } from "@/lib/rbac";
import { rootDestination } from "@/pages/Index";
import { sanitizeNextPath } from "@/lib/authVerify";

const src = (p: string) => readFileSync(p, "utf8");

describe("admin / participant routing", () => {
  it("admin login lands in the admin flow, never /my or /", () => {
    expect(adminEntryDestination("owner")).toBe("/admin");
    expect(adminEntryDestination("viewer")).toBe("/admin");
    expect(src("src/pages/admin/AdminLogin.tsx")).toContain('navigate("/admin")');
  });
  it("participant-only user cannot enter admin namespace", () => {
    expect(adminEntryDestination(null)).toBe("/admin/login");
    expect(highestRole([])).toBeNull();
  });
  it("/admin with missing context renders Admin Home instead of redirecting to /", () => {
    const d = src("src/pages/admin/AdminDashboard.tsx");
    expect(d).toContain("<AdminHome");
    expect(d).not.toMatch(/navigate\("\/"/);
    expect(src("src/App.tsx")).toContain('path="/admin/home"');
  });
  it("admin logout goes to /admin/login", () => {
    expect(src("src/pages/admin/AdminDashboard.tsx")).toMatch(/signOut\(\);[\s\S]*?navigate\("\/admin\/login"/);
  });
  it("admin court page falls back inside /admin", () => {
    expect(src("src/pages/admin/AdminCourt.tsx")).toContain('useCourtContextGuard(courtNumber, "/admin")');
    expect(src("src/pages/public/PublicCourt.tsx")).toContain("useCourtContextGuard(courtNumber)");
  });
  it("root / stays participant-centric", () => {
    expect(rootDestination(true)).toBe("/my");
    expect(rootDestination(false)).toBe("/auth");
  });
  it("same user can hold both personas: participant routes are separate from /admin", () => {
    const app = src("src/App.tsx");
    for (const r of ['path="/my"', 'path="/admin"', 'path="/public"', 'path="/public/court/:courtId"', 'path="/auth/verify"']) {
      expect(app).toContain(r);
    }
    expect(sanitizeNextPath("/my/experience/x")).toBe("/my/experience/x");
  });
});

describe("RBAC permissions", () => {
  it("has exactly owner/admin/host/viewer", () => {
    expect([...STAFF_ROLES]).toEqual(["owner", "admin", "host", "viewer"]);
  });
  it("owner can manage roles; admin cannot", () => {
    expect(can("owner", "roles.manage")).toBe(true);
    expect(can("admin", "roles.manage")).toBe(false);
  });
  it("host cannot change schedules, capacity, Social or Shopify mappings", () => {
    for (const p of ["schedule.manage", "capacity.manage", "social.create", "shopify.manage", "roles.manage"] as const) {
      expect(can("host", p)).toBe(false);
    }
  });
  it("host can do event-day seats, rosters, scoring", () => {
    expect(can("host", "event.operate")).toBe(true);
    expect(can("host", "seats.manage")).toBe(true);
  });
  it("viewer can only read", () => {
    expect(can("viewer", "admin.read")).toBe(true);
    for (const p of ["event.operate", "seats.manage", "schedule.manage", "shopify.manage", "roles.manage"] as const) {
      expect(can("viewer", p)).toBe(false);
    }
  });
  it("highest role wins when a user has several rows", () => {
    expect(highestRole(["viewer", "owner"])).toBe("owner");
    expect(highestRole(["host", "admin"])).toBe("admin");
  });
  it("last-owner protection", () => {
    const one = [{ user_id: "a", role: "owner" }, { user_id: "b", role: "admin" }];
    expect(wouldRemoveLastOwner(one, "a", "admin")).toBe(true);
    expect(wouldRemoveLastOwner(one, "a", null)).toBe(true);
    expect(wouldRemoveLastOwner(one, "a", "owner")).toBe(false);
    expect(wouldRemoveLastOwner(one, "b", null)).toBe(false);
    const two = [...one, { user_id: "c", role: "owner" }];
    expect(wouldRemoveLastOwner(two, "a", "viewer")).toBe(false);
  });
  it("role management server function is owner-only with last-owner guard", () => {
    const fn = src("supabase/functions/manage-admins/index.ts");
    expect(fn).toContain('.eq("role", "owner")');
    expect(fn).toContain("last owner");
  });
  it("role-management and Shopify/schedule controls are permission-gated in the dashboard", () => {
    const d = src("src/pages/admin/AdminDashboard.tsx");
    expect(d).toContain('can("roles.manage") && <AdminManagement');
    expect(d).toContain('can("shopify.manage")');
    expect(d).toContain('can("seats.manage") && <SeatManager');
    expect(src("src/pages/admin/AdminSchedule.tsx")).toContain('can("schedule.manage")');
  });
  it("host-level edge functions accept owner/admin/host; reset-session owner/admin", () => {
    expect(src("supabase/functions/generate-rotation/index.ts")).toContain('["owner", "admin", "host"]');
    expect(src("supabase/functions/reset-session/index.ts")).toContain('["owner", "admin"]');
  });
});

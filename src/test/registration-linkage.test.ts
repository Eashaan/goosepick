import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const app = read("src/App.tsx");
const roster = read("src/components/public/PersonalRoster.tsx");
const myExperience = read("src/pages/participant/MyExperience.tsx");
const adminRegistrations = read("src/pages/admin/AdminRegistrations.tsx");
const phase2Sql = read("db/phase2_registration_assignment.sql");

describe("Phase 2 — participant roster linkage", () => {
  it("keeps the legacy public routes and adds a protected personal experience route", () => {
    expect(app).toContain('path="/public"');
    expect(app).toContain('path="/public/court/:courtId"');
    expect(app).toContain('path="/public/group/:groupId"');
    expect(app).toContain('path="/my/experience/:registrationId"');
    expect(app).toMatch(/path="\/my\/experience\/:registrationId"[\s\S]*?<RequireParticipant>/);
  });

  it("preserves public localStorage selection when no locked player is supplied", () => {
    expect(roster).toContain('localStorage.getItem(`${storagePrefix}_person`)');
    expect(roster).toContain('localStorage.setItem(`${storagePrefix}_person`, playerId)');
    expect(roster).toContain("Please select your name in the dropdown below");
    expect(roster).toContain("Change Player");
  });

  it("lets authenticated registrations lock player identity without touching the public selector key", () => {
    expect(roster).toContain("lockedPlayerId?: string");
    expect(roster).toContain("if (lockedPlayerId)");
    expect(roster).toContain("!lockedPlayerId &&");
    expect(myExperience).toContain("lockedPlayerId={linkedPlayer.id}");
    expect(myExperience).not.toContain('localStorage.setItem(`${storagePrefix}_person`');
  });

  it("uses registration RLS as the ownership boundary and does not fetch another account by profile id", () => {
    expect(myExperience).toContain('.from("experience_registrations")');
    expect(myExperience).toContain('.eq("id", registrationId!)');
    expect(myExperience).toContain("RLS on experience_registrations is the ownership boundary");
    expect(myExperience).not.toMatch(/\.eq\(["']profile_id["']/);
    expect(myExperience).not.toMatch(/\.eq\(["']purchaser_profile_id["']/);
  });

  it("loads historical roster data by the registration session, not the current active session", () => {
    expect(myExperience).toContain("const sessionId = registration?.session_id ?? null");
    expect(myExperience).not.toContain("useActiveSession");
    expect(myExperience).toContain('.eq("session_id", sessionId!)');
  });
});

describe("Phase 2 — admin assignment", () => {
  it("keeps the manual roster engine and assigns registrations into players", () => {
    const adminCourt = read("src/pages/admin/AdminCourt.tsx");
    const adminGroup = read("src/pages/admin/AdminGroup.tsx");
    expect(adminCourt).toContain('.from("players")');
    expect(adminCourt).toContain("Add player mutation");
    expect(adminGroup).toContain('.from("players")');
    expect(adminGroup).toContain("const addPlayer = useMutation");
    expect(phase2Sql).toContain("INSERT INTO public.players");
    expect(phase2Sql).toContain("registration_id");
    expect(phase2Sql).toContain("profile_id");
  });

  it("scopes the pool to the current session and only assignable states", () => {
    expect(adminRegistrations).toContain('.eq("session_id", sessionId!)');
    expect(adminRegistrations).toContain('.in("status", ["paid", "profile_required", "confirmed"])');
    expect(adminRegistrations).toContain("activeSession?.status === \"ended\"");
  });

  it("atomically guards duplicate registration assignment and target session mismatch", () => {
    expect(phase2Sql).toContain("FOR UPDATE");
    expect(phase2Sql).toContain("WHERE registration_id = p_registration_id");
    expect(phase2Sql).toContain("Registration is already assigned to a roster player");
    expect(phase2Sql).toContain("Roster target belongs to a different session");
    expect(phase2Sql).toContain("Ended sessions cannot be changed");
  });

  it("restricts the SECURITY DEFINER assignment helper to authenticated/service roles", () => {
    const signature = "public.assign_registration_to_roster(uuid, text, bigint, uuid)";
    expect(phase2Sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`);
    expect(phase2Sql).toContain(`REVOKE ALL ON FUNCTION ${signature} FROM anon;`);
    expect(phase2Sql).toContain(`GRANT EXECUTE ON FUNCTION ${signature} TO authenticated, service_role;`);
    expect(phase2Sql).toContain("IF NOT public.is_admin()");
  });

  it("keeps a later guest claim synced to the existing roster player", () => {
    expect(phase2Sql).toContain("AFTER UPDATE OF profile_id ON public.experience_registrations");
    expect(phase2Sql).toContain("SET profile_id = NEW.profile_id");
    expect(phase2Sql).toContain("WHERE registration_id = NEW.id");
  });
});

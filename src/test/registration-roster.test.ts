import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assignRegistrationToRoster,
  isDuplicateNameError,
  isDuplicateRegistrationError,
  isMissingRpcError,
  resolveContactEmail,
  resolveRosterName,
  type AssignmentClient,
  type RegistrationPoolRow,
} from "@/lib/registrationAssignment";
import { buildSyntheticGroupCourtState, formatCourtNumbersLabel } from "@/lib/groupRoster";
import { deriveRegistrationState, isRegistrationOpenable } from "@/integrations/supabase/participantDb";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const baseRegistration: RegistrationPoolRow = {
  id: "reg-1",
  session_id: "sess-1",
  seat_index: 1,
  status: "paid",
  participant_name: null,
  participant_email: null,
  profile_id: "prof-1",
  purchaser_profile_id: "prof-buyer",
  created_at: "2026-09-05T00:00:00Z",
  profile: { first_name: "Asha", last_name: "Mehta", email: "asha@example.com" },
  purchaser: { first_name: "Rohan", last_name: null, email: "rohan@example.com" },
  commerce_order: { shopify_order_name: "#1042", purchaser_email: "rohan@example.com" },
};

/** Fake client that records rpc + insert calls. */
function fakeClient(options: {
  rpc?: { data?: unknown; error?: { code?: string; message: string } | null };
  insert?: { data?: { id: string } | null; error?: { code?: string; message: string; details?: string } | null };
}) {
  const calls: { rpc: unknown[]; insert: unknown[] } = { rpc: [], insert: [] };
  const client: AssignmentClient = {
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args });
      return { data: options.rpc?.data ?? null, error: options.rpc?.error ?? null };
    },
    from: () => ({
      insert: (row) => {
        calls.insert.push(row);
        return {
          select: () => ({
            single: async () => ({
              data: options.insert?.data ?? { id: "player-new" },
              error: options.insert?.error ?? null,
            }),
          }),
        };
      },
    }),
  };
  return { client, calls };
}

describe("registration → roster: name + contact resolution", () => {
  it("prefers the participant profile, then participant_name, then the purchaser", () => {
    expect(resolveRosterName(baseRegistration)).toBe("Asha Mehta");
    expect(resolveRosterName({ ...baseRegistration, profile: { first_name: "Asha", last_name: null, email: null } })).toBe("Asha");
    expect(resolveRosterName({ ...baseRegistration, profile: null, participant_name: " Guest Two " })).toBe("Guest Two");
    expect(resolveRosterName({ ...baseRegistration, profile: null, participant_name: null })).toBe("Rohan");
    expect(resolveRosterName({ ...baseRegistration, profile: null, participant_name: "  ", purchaser: null })).toBeNull();
  });

  it("surfaces an email for the admin without ever writing it to players", () => {
    expect(resolveContactEmail(baseRegistration)).toBe("asha@example.com");
    expect(resolveContactEmail({ ...baseRegistration, profile: null })).toBe("rohan@example.com");
    expect(resolveContactEmail({ ...baseRegistration, profile: null, commerce_order: null, purchaser: null, participant_email: "g@x.com" })).toBe("g@x.com");
  });
});

describe("registration → roster: assignment writes into the EXISTING players table", () => {
  it("uses the atomic RPC when it is available", async () => {
    const { client, calls } = fakeClient({ rpc: { data: { ok: true, status: "assigned", player_id: "p-1" } } });
    const result = await assignRegistrationToRoster({
      registration: baseRegistration,
      sessionId: "sess-1",
      target: { kind: "court", courtId: 7 },
      name: "Asha Mehta",
      client,
    });
    expect(result).toEqual({ status: "assigned", playerId: "p-1", via: "rpc" });
    expect(calls.rpc).toHaveLength(1);
    expect((calls.rpc[0] as { fn: string }).fn).toBe("assign_registration_to_roster");
    expect((calls.rpc[0] as { args: Record<string, unknown> }).args).toMatchObject({
      p_registration_id: "reg-1",
      p_session_id: "sess-1",
      p_court_id: 7,
      p_group_id: null,
      p_name: "Asha Mehta",
    });
    expect(calls.insert).toHaveLength(0);
  });

  it("falls back to the guarded direct players insert until the RPC is applied", async () => {
    const { client, calls } = fakeClient({
      rpc: { error: { code: "PGRST202", message: "Could not find the function public.assign_registration_to_roster" } },
    });
    const result = await assignRegistrationToRoster({
      registration: baseRegistration,
      sessionId: "sess-1",
      target: { kind: "group", groupId: "grp-9" },
      name: "Asha Mehta",
      client,
    });
    expect(result).toEqual({ status: "assigned", playerId: "player-new", via: "insert" });
    expect(calls.insert).toHaveLength(1);
    // Same row shape the admin roster already uses + the two linkage columns.
    expect(calls.insert[0]).toEqual({
      session_id: "sess-1",
      court_id: null,
      group_id: "grp-9",
      name: "Asha Mehta",
      is_guest: false,
      added_by_admin: true,
      profile_id: "prof-1",
      registration_id: "reg-1",
    });
    // No PII columns ever reach players.
    expect(Object.keys(calls.insert[0] as object)).not.toEqual(expect.arrayContaining(["email", "phone", "participant_email"]));
  });

  it("treats the unique registration index as an idempotent duplicate guard", async () => {
    const { client } = fakeClient({
      rpc: { error: { code: "PGRST202", message: "Could not find the function" } },
      insert: {
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "players_registration_id_key"',
        },
      },
    });
    const result = await assignRegistrationToRoster({
      registration: baseRegistration,
      sessionId: "sess-1",
      target: { kind: "court", courtId: 1 },
      name: "Asha Mehta",
      client,
    });
    expect(result.status).toBe("already_assigned");
  });

  it("propagates roster-name collisions so the admin can pick another name", async () => {
    const { client } = fakeClient({
      rpc: { error: { code: "PGRST202", message: "Could not find the function" } },
      insert: {
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "players_session_court_name_idx"',
        },
      },
    });
    await expect(
      assignRegistrationToRoster({
        registration: baseRegistration,
        sessionId: "sess-1",
        target: { kind: "court", courtId: 1 },
        name: "Asha Mehta",
        client,
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("honours RPC-side validation results (already assigned / rejected)", async () => {
    const already = fakeClient({ rpc: { data: { ok: true, status: "already_assigned", player_id: "p-old" } } });
    await expect(
      assignRegistrationToRoster({ registration: baseRegistration, sessionId: "sess-1", target: { kind: "court", courtId: 1 }, name: "Asha", client: already.client }),
    ).resolves.toMatchObject({ status: "already_assigned", playerId: "p-old" });

    const rejected = fakeClient({ rpc: { data: { ok: false, error: "Ended sessions are archived and cannot be modified." } } });
    await expect(
      assignRegistrationToRoster({ registration: baseRegistration, sessionId: "sess-1", target: { kind: "court", courtId: 1 }, name: "Asha", client: rejected.client }),
    ).rejects.toThrow(/archived/);
    expect(rejected.calls.insert).toHaveLength(0);
  });

  it("refuses cross-session, non-assignable, or nameless assignments before touching the database", async () => {
    const { client, calls } = fakeClient({});
    await expect(
      assignRegistrationToRoster({ registration: baseRegistration, sessionId: "other", target: { kind: "court", courtId: 1 }, name: "Asha", client }),
    ).rejects.toThrow(/different session/);
    await expect(
      assignRegistrationToRoster({ registration: { ...baseRegistration, status: "cancelled" }, sessionId: "sess-1", target: { kind: "court", courtId: 1 }, name: "Asha", client }),
    ).rejects.toThrow(/cancelled/);
    await expect(
      assignRegistrationToRoster({ registration: baseRegistration, sessionId: "sess-1", target: { kind: "court", courtId: 1 }, name: "   ", client }),
    ).rejects.toThrow(/roster name/);
    expect(calls.rpc).toHaveLength(0);
    expect(calls.insert).toHaveLength(0);
  });

  it("classifies database errors precisely", () => {
    expect(isMissingRpcError({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isMissingRpcError({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(isMissingRpcError({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isDuplicateRegistrationError({ code: "23505", message: "players_registration_id_key" })).toBe(true);
    expect(isDuplicateRegistrationError({ code: "23505", message: "players_session_group_name_idx" })).toBe(false);
    expect(isDuplicateNameError({ code: "23505", message: "players_session_group_name_idx" })).toBe(true);
  });
});

describe("registration → roster: admin surfaces", () => {
  it("adds the pool to the existing Players cards, not a parallel admin system", () => {
    const court = read("src/pages/admin/AdminCourt.tsx");
    const group = read("src/pages/admin/AdminGroup.tsx");
    for (const src of [court, group]) {
      expect(src).toContain("<RegistrationPool");
      expect(src).toContain('"Archived sessions can\'t be changed."');
      // Manual walk-in entry is preserved right next to it.
      expect(src).toContain('placeholder="Player name"');
      expect(src).toContain("Registered");
    }
    expect(court).toContain('target={{ kind: "court", courtId: courtNumber }}');
    expect(group).toContain('target={{ kind: "group", groupId }}');
    expect(read("src/pages/admin/AdminDashboard.tsx")).toContain("<RegistrationPoolSummary");
    expect(read("src/App.tsx")).not.toMatch(/\/admin\/registrations/);
  });

  it("scopes the pool to one session and to unlinked assignable seats", () => {
    const pool = read("src/hooks/useRegistrationPool.ts");
    expect(pool).toContain('.eq("session_id", sessionId!)');
    expect(pool).toContain(".in(\"status\", [...ASSIGNABLE_REGISTRATION_STATUSES])");
    expect(pool).toContain('.not("registration_id", "is", null)');
    expect(pool).toContain("waiting: registrations.filter((r) => !assigned.has(r.id))");
  });

  it("never writes to experience_registrations from the client", () => {
    for (const file of [
      "src/lib/registrationAssignment.ts",
      "src/hooks/useRegistrationPool.ts",
      "src/components/admin/RegistrationPool.tsx",
      "src/pages/participant/MyExperience.tsx",
      "src/pages/participant/MyGoosepick.tsx",
    ]) {
      const src = read(file);
      expect(src).not.toMatch(/from\("experience_registrations"\)[\s\S]{0,200}\.(insert|update|upsert|delete)\(/);
    }
  });
});

describe("registration → roster: review-only SQL (db/phase2_registration_assignment.sql)", () => {
  const sql = read("db/phase2_registration_assignment.sql");

  it("is additive and admin-gated, and never grants client writes on registrations", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.assign_registration_to_roster");
    expect(sql).toContain("IF NOT public.is_admin()");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("Ended sessions are archived and cannot be modified.");
    expect(sql).toContain("INSERT INTO public.players");
    expect(sql).toContain("WHEN unique_violation");
    expect(sql).not.toMatch(/GRANT[^;]*ON public\.experience_registrations/i);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*experience_registrations/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|POLICY)/i);
    expect(sql).not.toMatch(/ALTER TABLE/i);
  });

  it("locks down every SECURITY DEFINER function from PUBLIC and anon", () => {
    const bodies = sql.match(/CREATE OR REPLACE FUNCTION public\.\w+\([\s\S]*?\)[\s\S]*?\$\$;/g) || [];
    const definers = bodies
      .filter((b) => /SECURITY DEFINER/.test(b))
      .map((b) => b.match(/FUNCTION (public\.\w+)/)![1]);
    expect(definers).toEqual(["public.assign_registration_to_roster", "public.sync_registration_profile_to_player"]);
    for (const fn of definers) {
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn.replace(".", "\\.")}\\([^)]*\\) FROM PUBLIC;`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION ${fn.replace(".", "\\.")}\\([^)]*\\) FROM anon;`));
    }
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.assign_registration_to_roster(uuid, uuid, integer, uuid, text) TO authenticated, service_role;");
  });

  it("keeps players.profile_id in step when a registration is linked later", () => {
    expect(sql).toContain("AFTER UPDATE OF profile_id ON public.experience_registrations");
    expect(sql).toContain("SET profile_id = NEW.profile_id");
    expect(sql).toContain("p.registration_id = NEW.id");
  });
});

describe("participant experience route", () => {
  const app = read("src/App.tsx");
  const page = read("src/pages/participant/MyExperience.tsx");
  const roster = read("src/components/public/PersonalRoster.tsx");

  it("is registered behind the participant guard", () => {
    expect(app).toContain('"/my/experience/:registrationId"');
    const routeBlock = app.slice(app.indexOf('"/my/experience/:registrationId"'));
    expect(routeBlock.slice(0, 200)).toContain("<RequireParticipant>");
    expect(routeBlock.slice(0, 200)).toContain("<MyExperience />");
  });

  it("only loads a registration the signed-in user can see (RLS-scoped, null-safe)", () => {
    expect(page).toContain('.from("experience_registrations")');
    expect(page).toContain('.eq("id", registrationId!)');
    expect(page).toContain(".maybeSingle()");
    expect(page).toContain("We couldn't find this experience in your account.");
    expect(page).not.toMatch(/service_role/i);
  });

  it("identifies the linked player through registration_id and bypasses court/name selection", () => {
    expect(page).toContain('.eq("registration_id", registrationId!)');
    expect(page).toContain("fixedPlayerId={player.id}");
    expect(page).not.toContain("SelectItem");
    expect(page).not.toContain("useEventContext");
    expect(page).not.toContain("localStorage");
    // Reuses the public roster components rather than copying them.
    for (const component of ["<PersonalRoster", "<Leaderboard", "<CourtPulse", "<GroupCourtPulse"]) {
      expect(page).toContain(component);
    }
    expect(page).toContain("Your spot is confirmed. Roster coming soon.");
  });

  it("keeps the legacy /public name selection untouched", () => {
    expect(roster).toContain("const storagePrefix = `gp_${sessionKey}_${groupId || `court-${courtId}`}`");
    expect(roster).toContain("localStorage.getItem(`${storagePrefix}_person`)");
    expect(roster).toContain("localStorage.setItem(`${storagePrefix}_person`, playerId)");
    expect(roster).toContain('placeholder="Select your name"');
    expect(roster).toContain("fixedPlayerId = null");
    expect(roster).toContain("archived = false");
    for (const legacy of ["src/pages/public/PublicCourt.tsx", "src/pages/public/PublicGroup.tsx"]) {
      const src = read(legacy);
      expect(src).not.toContain("fixedPlayerId");
      expect(src).not.toContain("archived=");
      expect(src).toContain("<PersonalRoster");
    }
    expect(read("src/pages/public/PublicCourtSelector.tsx")).toContain("Select Your Court");
  });

  it("makes MyGoosepick cards open the experience page when there is something to open", () => {
    const my = read("src/pages/participant/MyGoosepick.tsx");
    expect(my).toContain("navigate(`/my/experience/${registration.id}`)");
    expect(my).toContain("isRegistrationOpenable(state)");
    expect(isRegistrationOpenable("roster_pending")).toBe(true);
    expect(isRegistrationOpenable("completed")).toBe(true);
    expect(isRegistrationOpenable("cancelled")).toBe(false);
    expect(isRegistrationOpenable("refunded")).toBe(false);
  });
});

describe("shared group roster helpers (PublicGroup + participant page)", () => {
  it("formats court numbers the same way everywhere", () => {
    expect(formatCourtNumbersLabel([])).toBe("Group");
    expect(formatCourtNumbersLabel([1])).toBe("Court 1");
    expect(formatCourtNumbersLabel([1, 2])).toBe("Courts 1 & 2");
    expect(formatCourtNumbersLabel([1, 2, 3])).toBe("Courts 1, 2 & 3");
  });

  it("derives the synthetic round and phase exactly like PublicGroup did", () => {
    const state = buildSyntheticGroupCourtState({
      courtStates: [
        { is_live: true, current_match_global_index: 5 },
        { is_live: false, current_match_global_index: null },
      ],
      matches: [{ status: "completed" }, { status: "in_progress" }],
      groupId: "g1",
      syntheticCourtId: 3,
      sessionId: "s1",
      courtsInGroup: 2,
    });
    expect(state).toMatchObject({ id: "synthetic-g1", court_id: 3, current_match_index: 2, phase: "in_progress", session_id: "s1" });

    const done = buildSyntheticGroupCourtState({
      courtStates: [{ is_live: false, current_match_global_index: null }],
      matches: [{ status: "completed" }],
      groupId: null,
      syntheticCourtId: 0,
      sessionId: null,
      courtsInGroup: 1,
    });
    expect(done?.phase).toBe("completed");
    expect(buildSyntheticGroupCourtState({ courtStates: [], matches: [], groupId: "g", syntheticCourtId: 0, sessionId: null, courtsInGroup: 1 })).toBeUndefined();
    expect(read("src/pages/public/PublicGroup.tsx")).toContain("buildSyntheticGroupCourtState(");
  });

  it("keeps registration state derivation stable", () => {
    const reg = { id: "r", session_id: "s", profile_id: "p", purchaser_profile_id: null, seat_index: 1, participant_name: null, status: "paid" as const, created_at: "", sessions: { id: "s", date: "2026-09-05", status: "draft" as const, event_type: "social" as const, session_label: null } };
    expect(deriveRegistrationState(reg, false)).toBe("roster_pending");
    expect(deriveRegistrationState(reg, true)).toBe("roster_ready");
    expect(deriveRegistrationState({ ...reg, sessions: { ...reg.sessions, status: "live" } }, true)).toBe("live");
    expect(deriveRegistrationState({ ...reg, sessions: { ...reg.sessions, status: "ended" } }, true)).toBe("completed");
  });
});

describe("participant deep links survive first-time profile completion", () => {
  it("RequireParticipant remembers the intended path and MyProfile returns to it (in-app only)", () => {
    const guard = read("src/pages/participant/RequireParticipant.tsx");
    const profile = read("src/pages/participant/MyProfile.tsx");
    expect(guard).toContain('navigate("/my/profile", { replace: true, state: { from: `${location.pathname}${location.search}` } })');
    expect(profile).toContain('rawFrom.startsWith("/my") ? rawFrom : "/my"');
    expect(profile).toContain("navigate(returnTo, { replace: true })");
  });
});

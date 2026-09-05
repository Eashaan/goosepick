import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("foundation regression guards", () => {
  it("keeps standalone scoring session-aware and admin-authorized", () => {
    const scopeSql = read("supabase/migrations/20260905021000_session_scope_operational_state.sql");
    expect(scopeSql).toContain("p_session_id uuid");
    expect(scopeSql).toContain("UNIQUE (session_id, court_id)");
    expect(scopeSql).toContain("UNIQUE (session_id, court_id, match_index)");

    const authSql = read("supabase/migrations/20260905064000_authorize_standalone_scoring_rpcs.sql");
    expect(authSql).toContain("IF NOT public.is_admin()");
    expect(authSql).toContain("Admin access required");
    expect(authSql).toContain("REVOKE ALL ON FUNCTION public.start_match_atomic");
  });

  it("keeps group scoring server-atomic, serialized, and admin-authorized", () => {
    const adminGroup = read("src/pages/admin/AdminGroup.tsx");
    expect(adminGroup).toContain('supabase.rpc("start_group_match_atomic"');
    expect(adminGroup).toContain('supabase.rpc("end_group_match_atomic"');
    expect(adminGroup).not.toContain('.update({ status: "in_progress", started_at: new Date().toISOString() })');

    const sql = read("supabase/migrations/20260905061000_group_atomic_scoring_and_feedback_scope.sql");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.start_group_match_atomic");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.end_group_match_atomic");
    expect(sql).toContain("IF NOT public.is_admin()");
    expect(sql).toContain("FROM public.court_groups");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("is currently playing on another court");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.start_group_match_atomic");
  });

  it("never treats group database court ids as display court numbers", () => {
    const adminGroup = read("src/pages/admin/AdminGroup.tsx");
    expect(adminGroup).toContain("groupCourtUnit?.group_court_numbers");
    expect(adminGroup).toContain("const courtDisplayNumber = (cn: number): number => cn");

    const generator = read("supabase/functions/generate-group-rotation/index.ts");
    expect(generator).toContain("group_court_numbers");
    expect(generator).toContain("group_physical_courts");
    expect(generator).toContain("group.court_ids.map((_: number, i: number) => i + 1)");
  });

  it("keeps participant browser state scoped to session and unit", () => {
    const roster = read("src/components/public/PersonalRoster.tsx");
    expect(roster).toContain('const storagePrefix = `gp_${sessionKey}_${groupId || `court-${courtId}`}`');
    expect(roster).not.toContain('const shownKey = `gp_rank_popup_${courtId}_${selectedPlayerId}`');
    expect(roster).toContain('`${storagePrefix}_rank_popup_${selectedPlayerId}`');
  });

  it("binds feedback to session and canonical group membership", () => {
    const feedbackFunction = read("supabase/functions/submit-feedback/index.ts");
    expect(feedbackFunction).toContain("session_id");
    expect(feedbackFunction).toContain("group_id: resolvedGroupId");
    expect(feedbackFunction).toContain("group_physical_courts");
    expect(feedbackFunction).toContain("120 characters or less");
  });

  it("allows multiple same-day sessions while limiting live scope", () => {
    const sql = read("supabase/migrations/20260905054500_allow_multiple_sessions_same_day.sql");
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS sessions_city_id_event_type_location_id_date_key");
    expect(sql).toContain("WHERE status = 'live'");
    expect(sql).toContain("COALESCE(location_id");
  });
});

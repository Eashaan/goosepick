from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, text: str) -> None:
    Path(path).write_text(text)


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"Expected one regex match in {path}, got {count}: {pattern}")
    write(path, updated)


# -----------------------------------------------------------------------------
# SetupWizard: every created/read mutable court object belongs to activeSessionId.
# -----------------------------------------------------------------------------
path = "src/components/admin/SetupWizard.tsx"
replace_once(
    path,
    '''        .eq("date", today)\n        .in("status", ["draft", "live"]);''',
    '''        .eq("date", today)\n        .in("status", ["draft", "live"])\n        .order("status", { ascending: false })\n        .order("created_at", { ascending: false })\n        .limit(1);''',
)
replace_once(
    path,
    '''          .eq("event_id", eventId)\n          .eq("name", `Court ${i}`);''',
    '''          .eq("event_id", eventId)\n          .eq("name", `Court ${i}`)\n          .eq("session_id", activeSessionId);''',
)
replace_once(
    path,
    '''              location_id: locationId || null,\n              format_type: finalFormat,''',
    '''              location_id: locationId || null,\n              format_type: finalFormat,\n              session_id: activeSessionId,''',
)
replace_once(
    path,
    '''        .from("courts")\n        .select("id")\n        .eq("event_id", eventId);''',
    '''        .from("courts")\n        .select("id")\n        .eq("event_id", eventId)\n        .eq("session_id", activeSessionId);''',
)
replace_once(
    path,
    '''            .select("court_id")\n            .eq("court_id", court.id)\n            .maybeSingle();''',
    '''            .select("court_id")\n            .eq("court_id", court.id)\n            .eq("session_id", activeSessionId)\n            .maybeSingle();''',
)
replace_once(
    path,
    '''            await supabase.from("court_state").insert({ court_id: court.id } as any);''',
    '''            await supabase.from("court_state").insert({ court_id: court.id, session_id: activeSessionId } as any);''',
)
replace_once(
    path,
    '''            .eq("event_id", eventId)\n            .eq("name", `Court ${n}`)\n            .maybeSingle();''',
    '''            .eq("event_id", eventId)\n            .eq("name", `Court ${n}`)\n            .eq("session_id", activeSessionId)\n            .maybeSingle();''',
)
replace_once(
    path,
    '''        .eq("city_id", cityId)\n        .eq("event_type", scopeEventType)\n        .eq("is_locked", false);''',
    '''        .eq("city_id", cityId)\n        .eq("event_type", scopeEventType)\n        .eq("session_id", activeSessionId)\n        .eq("is_locked", false);''',
)
replace_once(
    path,
    '''        .from("courts")\n        .select("id, name")\n        .eq("event_id", eventId);''',
    '''        .from("courts")\n        .select("id, name")\n        .eq("event_id", eventId)\n        .eq("session_id", activeSessionId);''',
)
replace_once(
    path,
    '''          .eq("event_type", scopeEventType)\n          .eq("type", "court")''',
    '''          .eq("event_type", scopeEventType)\n          .eq("session_id", activeSessionId)\n          .eq("type", "court")''',
)
replace_once(
    path,
    '''            location_id: locationId,\n            type: "court",''',
    '''            location_id: locationId,\n            session_id: activeSessionId,\n            type: "court",''',
)
replace_once(
    path,
    '''          location_id: locationId,\n          type: "group",''',
    '''          location_id: locationId,\n          session_id: activeSessionId,\n          type: "group",''',
)
regex_once(
    path,
    r'''\n      // 6\. Link all courts to this session\n.*?\n      return activeSessionId;''',
    '''\n      return activeSessionId;''',
)

# -----------------------------------------------------------------------------
# AdminCourt: atomic scoring always carries the active session id.
# -----------------------------------------------------------------------------
path = "src/pages/admin/AdminCourt.tsx"
replace_once(
    path,
    '''      const { data, error } = await supabase.rpc("start_match_atomic" as any, {\n        p_court_id: courtNumber,''',
    '''      if (!activeSessionId) throw new Error("No active session found");\n      const { data, error } = await supabase.rpc("start_match_atomic" as any, {\n        p_session_id: activeSessionId,\n        p_court_id: courtNumber,''',
)
replace_once(
    path,
    '''      const { data, error } = await supabase.rpc("end_match_atomic" as any, {\n        p_court_id: courtNumber,''',
    '''      if (!activeSessionId) throw new Error("No active session found");\n      const { data, error } = await supabase.rpc("end_match_atomic" as any, {\n        p_session_id: activeSessionId,\n        p_court_id: courtNumber,''',
)

# -----------------------------------------------------------------------------
# AdminDashboard: session-specific fallback court/group creation and group status.
# -----------------------------------------------------------------------------
path = "src/pages/admin/AdminDashboard.tsx"
replace_once(
    path,
    '''  const handleCourtClick = async (item: RenderItem) => {\n    if (!item.courtNumber) return;''',
    '''  const handleCourtClick = async (item: RenderItem) => {\n    if (!item.courtNumber) return;\n    if (!currentSessionId) {\n      toast.error("No active setup session found");\n      return;\n    }''',
)
replace_once(
    path,
    '''          location_id: selectedLocationId || null,\n          format_type: (item.formatType || "mystery_partner") as any,''',
    '''          location_id: selectedLocationId || null,\n          format_type: (item.formatType || "mystery_partner") as any,\n          session_id: currentSessionId,''',
)
replace_once(
    path,
    '''      await supabase.from("court_state").insert({ court_id: courtId } as any);''',
    '''      await supabase.from("court_state").insert({ court_id: courtId, session_id: currentSessionId } as any);''',
)
replace_once(
    path,
    '''        .update({ court_id: courtId } as any)\n        .eq("id", item.unitId);''',
    '''        .update({ court_id: courtId } as any)\n        .eq("id", item.unitId)\n        .eq("session_id", currentSessionId);''',
)
replace_once(
    path,
    '''        // Map by court_ids array key for lookup\n        const key = [...(g.court_ids || [])].sort((a, b) => a - b).join(",");\n        result.set(key, { playerCount: pCount || 0, matchCount, hasLive });''',
    '''        result.set(g.id, { playerCount: pCount || 0, matchCount, hasLive });''',
)
replace_once(
    path,
    '''    if (item.type === "group") {\n      const key = [...(item.courtNumbers || [])].sort((a, b) => a - b).join(",");\n      const status = groupStatusMap.get(key);''',
    '''    if (item.type === "group") {\n      if (!item.courtGroupId) return "setup";\n      const status = groupStatusMap.get(item.courtGroupId);''',
)
replace_once(
    path,
    '''      // 2. No linked group — create a new one and link it back to the court_unit\n      const { data, error } = await supabase\n        .from("court_groups")\n        .insert({\n          court_ids: item.courtNumbers,''',
    '''      // 2. No linked group — resolve this session's real court ids, create a group, and link it back.\n      if (!currentSessionId) throw new Error("No active setup session found");\n      const { data: memberUnits, error: memberError } = await supabase\n        .from("court_units" as any)\n        .select("court_id, court_number")\n        .eq("session_id", currentSessionId)\n        .eq("type", "court")\n        .in("court_number", item.courtNumbers);\n      if (memberError) throw memberError;\n      const memberCourtIds = (memberUnits || []).map((u: any) => u.court_id).filter(Boolean);\n      if (memberCourtIds.length !== item.courtNumbers.length) {\n        throw new Error("One or more group courts are not initialized for this session.");\n      }\n\n      const { data, error } = await supabase\n        .from("court_groups")\n        .insert({\n          court_ids: memberCourtIds,''',
)
replace_once(
    path,
    '''        .update({ court_group_id: newGroupId } as any)\n        .eq("id", item.unitId);''',
    '''        .update({ court_group_id: newGroupId } as any)\n        .eq("id", item.unitId)\n        .eq("session_id", currentSessionId);''',
)

# -----------------------------------------------------------------------------
# Context guard: a stale court URL from Session A cannot be opened in Session B.
# -----------------------------------------------------------------------------
path = "src/hooks/useCourtContextGuard.tsx"
replace_once(
    path,
    '''import { useEventContext } from "./useEventContext";''',
    '''import { useEventContext } from "./useEventContext";\nimport { useActiveSession } from "./useActiveSession";''',
)
replace_once(
    path,
    '''  } = useEventContext();\n\n  // Fetch court to validate it belongs to current context''',
    '''  } = useEventContext();\n  const { sessionId: activeSessionId, sessionLoading } = useActiveSession();\n\n  // Fetch court to validate it belongs to current context and active run''',
)
replace_once(
    path,
    '''    queryKey: ["court_context_check", courtId],''',
    '''    queryKey: ["court_context_check", courtId, activeSessionId],''',
)
replace_once(
    path,
    '''        .select("id, event_id, location_id")''',
    '''        .select("id, event_id, location_id, session_id")''',
)
replace_once(
    path,
    '''    if (contextLoading || courtLoading) return;''',
    '''    if (contextLoading || courtLoading || sessionLoading) return;''',
)
replace_once(
    path,
    '''    // Court doesn't belong to selected event\n    if (court.event_id !== selectedEventId) {''',
    '''    // Court must belong to the active session, not just the same event/location.\n    if (activeSessionId && court.session_id !== activeSessionId) {\n      navigate("/", { replace: true });\n      return;\n    }\n\n    // Court doesn't belong to selected event\n    if (court.event_id !== selectedEventId) {''',
)
replace_once(
    path,
    '''  }, [contextLoading, courtLoading, court, selectedEventId, selectedLocationId, requiresLocation, isContextValid, navigate]);\n\n  return { isValidating: contextLoading || courtLoading || !validated };''',
    '''  }, [contextLoading, courtLoading, sessionLoading, activeSessionId, court, selectedEventId, selectedLocationId, requiresLocation, isContextValid, navigate]);\n\n  return { isValidating: contextLoading || courtLoading || sessionLoading || !validated };''',
)

# -----------------------------------------------------------------------------
# generate-rotation: replace the broken/legacy handler while preserving generator.
# -----------------------------------------------------------------------------
path = "supabase/functions/generate-rotation/index.ts"
new_handler = r'''serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await userSupabase.auth.getClaims(token);
    if (claimsError || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid authentication" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", claims.claims.sub)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError || !roleData) {
      return new Response(JSON.stringify({ ok: false, error: "Insufficient permissions" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { courtId, sessionId } = await req.json();
    if (!courtId) {
      return new Response(JSON.stringify({ ok: false, error: "Court ID is required" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: court, error: courtError } = await supabase
      .from("courts")
      .select("id, session_id")
      .eq("id", courtId)
      .maybeSingle();
    if (courtError || !court) {
      return new Response(JSON.stringify({ ok: false, error: "Court not found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resolvedSessionId = sessionId || court.session_id || null;
    if (!resolvedSessionId) {
      return new Response(JSON.stringify({ ok: false, error: "Session ID is required" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (court.session_id && court.session_id !== resolvedSessionId) {
      return new Response(JSON.stringify({ ok: false, error: "Court does not belong to the active session" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: players, error: playersError } = await supabase
      .from("players")
      .select("id, name")
      .eq("court_id", courtId)
      .eq("session_id", resolvedSessionId)
      .order("created_at", { ascending: true });
    if (playersError) {
      return new Response(JSON.stringify({ ok: false, error: "Failed to load players" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const n = players?.length || 0;
    if (n < 8 || n > 12) {
      return new Response(JSON.stringify({ ok: false, error: "Mystery Partner requires 8 to 12 players" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { count: existingCount, error: existingError } = await supabase
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("court_id", courtId)
      .eq("session_id", resolvedSessionId)
      .is("group_id", null);
    if (existingError) throw existingError;
    if ((existingCount || 0) > 0) {
      return new Response(JSON.stringify({ ok: false, error: "Rotation already exists for this court and session" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = generateRotation(players as Player[], n);
    if (!result.ok) {
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const matchInserts = result.matches.map((match, index) => ({
      court_id: courtId,
      match_index: index,
      team1_player1_id: match.team1_player1_id,
      team1_player2_id: match.team1_player2_id,
      team2_player1_id: match.team2_player1_id,
      team2_player2_id: match.team2_player2_id,
      status: "pending",
      override_played: false,
      session_id: resolvedSessionId,
    }));
    const { error: insertError } = await supabase.from("matches").insert(matchInserts);
    if (insertError) {
      console.error("Database error inserting matches:", insertError);
      return new Response(JSON.stringify({ ok: false, error: "Failed to save rotation" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: stateError } = await supabase
      .from("court_state")
      .upsert(
        {
          court_id: courtId,
          session_id: resolvedSessionId,
          current_match_index: 0,
          phase: "idle",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "session_id,court_id" },
      );
    if (stateError) {
      console.error("Database error updating court state:", stateError);
      await supabase.from("matches").delete().eq("court_id", courtId).eq("session_id", resolvedSessionId).is("group_id", null);
      return new Response(JSON.stringify({ ok: false, error: "Failed to initialize court state" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const opponentCounts: Record<string, number> = {};
      const makePairKey = (a: string, b: string) => [a, b].sort().join("-");
      for (const m of result.matches) {
        for (const p1 of [m.team1_player1_id, m.team1_player2_id]) {
          for (const p2 of [m.team2_player1_id, m.team2_player2_id]) {
            const key = makePairKey(p1, p2);
            opponentCounts[key] = (opponentCounts[key] || 0) + 1;
          }
        }
      }
      let repeatOpponentCount = 0;
      for (const count of Object.values(opponentCounts)) {
        if (count > 1) repeatOpponentCount += count - 1;
      }
      const diag = result.diagnostics;
      let fairnessScore = 100;
      if (diag.max_matches_per_player - diag.min_matches_per_player > 1) fairnessScore -= 10;
      if (diag.max_sitout_streak > 2) fairnessScore -= 10;
      fairnessScore -= diag.repeat_partner_count * 2;
      fairnessScore -= repeatOpponentCount;
      fairnessScore = Math.max(0, fairnessScore);

      const { error: deleteAuditError } = await supabase
        .from("rotation_audit")
        .delete()
        .eq("court_id", courtId)
        .eq("session_id", resolvedSessionId);
      if (deleteAuditError) throw deleteAuditError;

      const { error: auditError } = await supabase.from("rotation_audit").insert({
        session_id: resolvedSessionId,
        court_id: courtId,
        total_players: n,
        matches_per_player_min: diag.min_matches_per_player,
        matches_per_player_max: diag.max_matches_per_player,
        max_consecutive_sitouts: diag.max_sitout_streak,
        repeat_partner_count: diag.repeat_partner_count,
        repeat_opponent_count: repeatOpponentCount,
        fairness_score: fairnessScore,
      });
      if (auditError) throw auditError;
    } catch (auditErr) {
      console.error("Audit storage warning (non-blocking):", auditErr);
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, error: errorMessage }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});'''
regex_once(
    path,
    r'''serve\(async \(req\) => \{.*?\n\}\);\n\n// Main generation function''',
    new_handler + "\n\n// Main generation function",
)

# -----------------------------------------------------------------------------
# Session lifecycle: ended sessions are immutable history, never resettable.
# -----------------------------------------------------------------------------
path = "src/components/admin/SessionLifecycleControls.tsx"
replace_once(
    path,
    '''      {(isDraft || isEnded || isLive) && (''',
    '''      {(isDraft || isLive) && (''',
)

# -----------------------------------------------------------------------------
# Generated Supabase types: reflect schema/RPC fields added by the migration.
# -----------------------------------------------------------------------------
path = "src/integrations/supabase/types.ts"
replace_once(
    path,
    '''        Row: {\n          court_id: number\n          current_match_index: number''',
    '''        Row: {\n          court_id: number\n          current_match_index: number\n          id: string''',
)
replace_once(
    path,
    '''        Insert: {\n          court_id: number\n          current_match_index?: number''',
    '''        Insert: {\n          court_id: number\n          current_match_index?: number\n          id?: string''',
)
replace_once(
    path,
    '''        Update: {\n          court_id?: number\n          current_match_index?: number''',
    '''        Update: {\n          court_id?: number\n          current_match_index?: number\n          id?: string''',
)
replace_once(
    path,
    '''          is_locked: boolean\n          location_id: string | null\n          type: string''',
    '''          is_locked: boolean\n          location_id: string | null\n          session_id: string | null\n          type: string''',
)
replace_once(
    path,
    '''          is_locked?: boolean\n          location_id?: string | null\n          type: string''',
    '''          is_locked?: boolean\n          location_id?: string | null\n          session_id?: string | null\n          type: string''',
)
replace_once(
    path,
    '''          is_locked?: boolean\n          location_id?: string | null\n          type?: string''',
    '''          is_locked?: boolean\n          location_id?: string | null\n          session_id?: string | null\n          type?: string''',
)
replace_once(
    path,
    '''          {\n            foreignKeyName: "court_units_location_id_fkey"\n            columns: ["location_id"]\n            isOneToOne: false\n            referencedRelation: "locations"\n            referencedColumns: ["id"]\n          },''',
    '''          {\n            foreignKeyName: "court_units_location_id_fkey"\n            columns: ["location_id"]\n            isOneToOne: false\n            referencedRelation: "locations"\n            referencedColumns: ["id"]\n          },\n          {\n            foreignKeyName: "court_units_session_id_fkey"\n            columns: ["session_id"]\n            isOneToOne: false\n            referencedRelation: "sessions"\n            referencedColumns: ["id"]\n          },''',
)
replace_once(
    path,
    '''          p_court_id: number\n          p_is_override?: boolean''',
    '''          p_court_id: number\n          p_is_override?: boolean\n          p_session_id: string''',
)
replace_once(
    path,
    '''        Args: { p_court_id: number; p_match_id: string; p_match_index: number }''',
    '''        Args: { p_court_id: number; p_match_id: string; p_match_index: number; p_session_id: string }''',
)

print("Foundation repair 2 caller patch applied successfully")

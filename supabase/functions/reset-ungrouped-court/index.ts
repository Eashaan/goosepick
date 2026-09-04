import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const assertNoError = (label: string, error: any) => {
  if (error) {
    throw new Error(`${label}: ${error.message || String(error)}`);
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, message: "Unauthorized" }), {
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
      return new Response(JSON.stringify({ ok: false, message: "Invalid authentication" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claims.claims.sub;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    assertNoError("Admin lookup failed", roleError);
    if (!roleData) {
      return new Response(JSON.stringify({ ok: false, message: "Insufficient permissions" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { courtId, sessionId, cityId, eventType, locationId } = await req.json();
    if (!courtId || !sessionId || !cityId || !eventType) {
      return new Response(
        JSON.stringify({ ok: false, message: "courtId, sessionId, cityId, and eventType are required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Confirm the requested session belongs to the requested scope.
    let sessionQuery = supabase
      .from("sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("city_id", cityId)
      .eq("event_type", eventType);
    sessionQuery = locationId
      ? sessionQuery.eq("location_id", locationId)
      : sessionQuery.is("location_id", null);
    const { data: scopedSession, error: sessionError } = await sessionQuery.maybeSingle();
    assertNoError("Session validation failed", sessionError);
    if (!scopedSession) throw new Error("Court reset scope does not match the selected session.");

    // Reject group-member courts. court_groups stores DB court ids in current setup;
    // the secondary court-number check preserves compatibility with legacy rows.
    const { data: groups, error: groupsError } = await supabase
      .from("court_groups")
      .select("id, court_ids")
      .eq("session_id", sessionId);
    assertNoError("Group membership lookup failed", groupsError);

    if ((groups || []).some((g: any) => (g.court_ids || []).includes(courtId))) {
      return new Response(
        JSON.stringify({ ok: false, message: "This court is part of a group. Please reset from the group screen." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let unitQuery = supabase
      .from("court_units")
      .select("id, court_number")
      .eq("court_id", courtId)
      .eq("session_id", sessionId)
      .eq("city_id", cityId)
      .eq("event_type", eventType);
    unitQuery = locationId
      ? unitQuery.eq("location_id", locationId)
      : unitQuery.is("location_id", null);
    const { data: unitData, error: unitError } = await unitQuery.maybeSingle();
    assertNoError("Court unit lookup failed", unitError);

    if (unitData?.court_number) {
      const isNumInGroup = (groups || []).some((g: any) =>
        (g.court_ids || []).includes(unitData.court_number)
      );
      if (isNumInGroup) {
        return new Response(
          JSON.stringify({ ok: false, message: "This court is part of a group. Please reset from the group screen." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    let result = await supabase.from("feedback").delete()
      .eq("court_id", courtId).eq("session_id", sessionId);
    assertNoError("Deleting feedback failed", result.error);

    result = await supabase.from("match_substitutions").delete()
      .eq("court_id", courtId).eq("session_id", sessionId).is("group_id", null);
    assertNoError("Deleting substitutions failed", result.error);

    result = await supabase.from("matches").delete()
      .eq("court_id", courtId).eq("session_id", sessionId).is("group_id", null);
    assertNoError("Deleting matches failed", result.error);

    result = await supabase.from("rotation_audit").delete()
      .eq("court_id", courtId).eq("session_id", sessionId);
    assertNoError("Deleting rotation audit failed", result.error);

    result = await supabase.from("players").delete()
      .eq("court_id", courtId).eq("session_id", sessionId).is("group_id", null);
    assertNoError("Deleting players failed", result.error);

    result = await supabase.from("court_state")
      .update({
        current_match_index: 0,
        phase: "idle",
        updated_at: new Date().toISOString(),
      })
      .eq("court_id", courtId)
      .eq("session_id", sessionId);
    assertNoError("Resetting court state failed", result.error);

    result = await supabase.from("courts")
      .update({ format_type: "mystery_partner" })
      .eq("id", courtId);
    assertNoError("Unlocking court format failed", result.error);

    if (unitData) {
      let unitUpdate = supabase.from("court_units")
        .update({ is_locked: false })
        .eq("id", unitData.id)
        .eq("session_id", sessionId)
        .eq("city_id", cityId)
        .eq("event_type", eventType);
      unitUpdate = locationId
        ? unitUpdate.eq("location_id", locationId)
        : unitUpdate.is("location_id", null);
      const { error: unitUnlockError } = await unitUpdate;
      assertNoError("Unlocking court unit failed", unitUnlockError);
    }

    console.log(`Ungrouped court ${courtId} reset for session ${sessionId}`);
    return new Response(JSON.stringify({ ok: true, message: "Court reset successfully" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Reset ungrouped court error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, message: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

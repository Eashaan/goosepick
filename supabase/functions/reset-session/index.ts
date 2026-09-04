import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const assertNoError = (label: string, error: any) => {
  if (error) throw new Error(`${label}: ${error.message || String(error)}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    const { sessionId, cityId, eventType, locationId } = await req.json();
    if (!sessionId || !cityId || !eventType) {
      return new Response(
        JSON.stringify({ ok: false, message: "sessionId, cityId, and eventType are required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Validate that the session being reset belongs to the selected scope.
    let sessionQuery = supabase
      .from("sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("city_id", cityId)
      .eq("event_type", eventType);
    sessionQuery = locationId
      ? sessionQuery.eq("location_id", locationId)
      : sessionQuery.is("location_id", null);
    const { data: scopedSession, error: scopedSessionError } = await sessionQuery.maybeSingle();
    assertNoError("Session validation failed", scopedSessionError);
    if (!scopedSession) throw new Error("Reset scope does not match the selected session.");

    // Find the setup record owned by this exact session.
    const { data: config, error: configError } = await supabase
      .from("session_configs")
      .select("id, session_id")
      .eq("session_id", sessionId)
      .maybeSingle();
    assertNoError("Session config lookup failed", configError);

    // Delete only operational rows tagged to THIS session. Every mutation is
    // checked so the function cannot report success after a silent DB failure.
    let result = await supabase.from("feedback").delete().eq("session_id", sessionId);
    assertNoError("Deleting feedback failed", result.error);

    result = await supabase.from("match_substitutions").delete().eq("session_id", sessionId);
    assertNoError("Deleting substitutions failed", result.error);

    result = await supabase.from("group_court_state").delete().eq("session_id", sessionId);
    assertNoError("Deleting group court state failed", result.error);

    result = await supabase.from("matches").delete().eq("session_id", sessionId);
    assertNoError("Deleting matches failed", result.error);

    result = await supabase.from("rotation_audit").delete().eq("session_id", sessionId);
    assertNoError("Deleting rotation audit failed", result.error);

    result = await supabase.from("group_physical_courts").delete().eq("session_id", sessionId);
    assertNoError("Deleting group physical courts failed", result.error);

    result = await supabase.from("players").delete().eq("session_id", sessionId);
    assertNoError("Deleting players failed", result.error);

    // IMPORTANT: do not delete every group sharing session_config_id. That would
    // destroy archived group definitions from prior sessions. Only this run's groups go.
    result = await supabase.from("court_groups").delete().eq("session_id", sessionId);
    assertNoError("Deleting court groups failed", result.error);

    // Court units are owned by this session; never clear another run's setup.
    const { error: unitDeleteError } = await supabase
      .from("court_units")
      .delete()
      .eq("session_id", sessionId);
    assertNoError("Deleting court units failed", unitDeleteError);

    if (config) {
      const { error: configResetError } = await supabase
        .from("session_configs")
        .update({ setup_completed: false, session_id: null })
        .eq("id", config.id);
      assertNoError("Resetting session configuration failed", configResetError);
    }

    // Session-scoped court state is disposable setup/runtime state.
    const { error: stateResetError } = await supabase
      .from("court_state")
      .delete()
      .eq("session_id", sessionId);
    assertNoError("Resetting court state failed", stateResetError);

    const { error: sessionResetError } = await supabase
      .from("sessions")
      .update({
        status: "draft",
        started_at: null,
        ended_at: null,
        is_active: false,
      })
      .eq("id", sessionId);
    assertNoError("Resetting session row failed", sessionResetError);

    console.log(`Session ${sessionId} reset successfully for scope: ${cityId}/${eventType}/${locationId || "null"}`);
    return new Response(
      JSON.stringify({ ok: true, message: "Session reset successfully. All current-session data cleared." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("Reset session error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, message: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ ok: false, message: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } =
      await userSupabase.auth.getClaims(token);

    if (claimsError || !claims?.claims?.sub) {
      return new Response(
        JSON.stringify({ ok: false, message: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const userId = claims.claims.sub;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Admin check
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(
        JSON.stringify({ ok: false, message: "Insufficient permissions" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { sessionId, cityId, eventType, locationId } = await req.json();

    if (!sessionId || !cityId || !eventType) {
      return new Response(
        JSON.stringify({ ok: false, message: "sessionId, cityId, and eventType are required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Find session_config for this scope
    let configQuery = supabase
      .from("session_configs")
      .select("id, event_id")
      .eq("city_id", cityId)
      .eq("event_type", eventType);
    if (locationId) {
      configQuery = configQuery.eq("location_id", locationId);
    } else {
      configQuery = configQuery.is("location_id", null);
    }
    const { data: config } = await configQuery.maybeSingle();

    // 2. Delete session-scoped data (order matters for FK constraints)
    // Children first, then parents
    await supabase.from("feedback").delete().eq("session_id", sessionId);
    await supabase.from("match_substitutions").delete().eq("session_id", sessionId);
    await supabase.from("group_court_state").delete().eq("session_id", sessionId);
    await supabase.from("matches").delete().eq("session_id", sessionId);
    await supabase.from("rotation_audit").delete().eq("session_id", sessionId);
    await supabase.from("group_physical_courts").delete().eq("session_id", sessionId);
    await supabase.from("players").delete().eq("session_id", sessionId);

    // 3. Delete court_groups (by session_config_id and/or session_id)
    if (config) {
      await supabase.from("court_groups").delete().eq("session_config_id", config.id);
    }
    await supabase.from("court_groups").delete().eq("session_id", sessionId);

    // 4. Delete court_units by scope (they don't have session_id)
    let unitDelete = supabase
      .from("court_units")
      .delete()
      .eq("city_id", cityId)
      .eq("event_type", eventType);
    if (locationId) {
      unitDelete = unitDelete.eq("location_id", locationId);
    } else {
      unitDelete = unitDelete.is("location_id", null);
    }
    await unitDelete;

    // 5. Reset session_config
    if (config) {
      await supabase
        .from("session_configs")
        .update({
          setup_completed: false,
          session_id: null,
        })
        .eq("id", config.id);
    }

    // 6. Reset session to draft
    await supabase
      .from("sessions")
      .update({
        status: "draft",
        started_at: null,
        ended_at: null,
        is_active: false,
      })
      .eq("id", sessionId);

    console.log(`Session ${sessionId} reset successfully for scope: ${cityId}/${eventType}/${locationId || 'null'}`);

    return new Response(
      JSON.stringify({ ok: true, message: "Session reset successfully. All data cleared." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("Reset session error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, message: msg }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

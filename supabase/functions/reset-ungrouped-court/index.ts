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

    const { courtId, sessionId, cityId, eventType, locationId } = await req.json();

    if (!courtId || !sessionId || !cityId || !eventType) {
      return new Response(
        JSON.stringify({ ok: false, message: "courtId, sessionId, cityId, and eventType are required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Check if this court_id belongs to any court_group in this session
    // court_groups store court_ids as an integer array — we need to check if courtId is in any group
    let groupQuery = supabase
      .from("court_groups")
      .select("id, court_ids")
      .eq("session_id", sessionId);

    const { data: groups } = await groupQuery;

    if (groups && groups.length > 0) {
      const isInGroup = groups.some((g: any) =>
        (g.court_ids || []).includes(courtId)
      );
      if (isInGroup) {
        return new Response(
          JSON.stringify({ ok: false, message: "This court is part of a group. Please reset from the group screen." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Also check by court_number in court_units → court_groups.court_ids contain court_numbers
    // The courtId param here is the courts.id (integer PK), but court_groups.court_ids stores court_numbers
    // We need to find the court_number for this court_id from court_units
    let unitQuery = supabase
      .from("court_units")
      .select("court_number")
      .eq("court_id", courtId)
      .eq("city_id", cityId)
      .eq("event_type", eventType);
    if (locationId) {
      unitQuery = unitQuery.eq("location_id", locationId);
    } else {
      unitQuery = unitQuery.is("location_id", null);
    }
    const { data: unitData } = await unitQuery.maybeSingle();

    if (unitData?.court_number) {
      const courtNum = unitData.court_number;
      const isNumInGroup = (groups || []).some((g: any) =>
        (g.court_ids || []).includes(courtNum)
      );
      if (isNumInGroup) {
        return new Response(
          JSON.stringify({ ok: false, message: "This court is part of a group. Please reset from the group screen." }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // 1. Delete feedback for this court + session
    await supabase.from("feedback").delete()
      .eq("court_id", courtId)
      .eq("session_id", sessionId);

    // 2. Delete match_substitutions for this court + session (ungrouped only)
    await supabase.from("match_substitutions").delete()
      .eq("court_id", courtId)
      .eq("session_id", sessionId)
      .is("group_id", null);

    // 3. Delete matches for this court + session (ungrouped only)
    await supabase.from("matches").delete()
      .eq("court_id", courtId)
      .eq("session_id", sessionId)
      .is("group_id", null);

    // 4. Delete rotation_audit for this court + session
    await supabase.from("rotation_audit").delete()
      .eq("court_id", courtId)
      .eq("session_id", sessionId);

    // 5. Delete players for this court + session (ungrouped only)
    await supabase.from("players").delete()
      .eq("court_id", courtId)
      .eq("session_id", sessionId)
      .is("group_id", null);

    // 6. Reset court_state
    await supabase.from("court_state")
      .update({
        current_match_index: 0,
        phase: "idle",
        updated_at: new Date().toISOString(),
      })
      .eq("court_id", courtId)
      .eq("session_id", sessionId);

    // 7. Unlock format on courts table
    await supabase.from("courts")
      .update({ format_type: "mystery_partner" })
      .eq("id", courtId);

    // 8. Unlock court_units is_locked flag
    if (unitData) {
      await supabase.from("court_units")
        .update({ is_locked: false })
        .eq("court_id", courtId)
        .eq("city_id", cityId)
        .eq("event_type", eventType);
    }

    console.log(`Ungrouped court ${courtId} reset for session ${sessionId}`);

    return new Response(
      JSON.stringify({ ok: true, message: "Court reset successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("Reset ungrouped court error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, message: msg }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

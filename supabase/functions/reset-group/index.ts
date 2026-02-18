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

    const { groupId, sessionId, clearPlayers } = await req.json();

    if (!groupId) {
      return new Response(
        JSON.stringify({ ok: false, message: "Group ID is required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify group exists
    const { data: group, error: groupError } = await supabase
      .from("court_groups")
      .select("id")
      .eq("id", groupId)
      .maybeSingle();

    if (groupError || !group) {
      return new Response(
        JSON.stringify({ ok: false, message: "Group not found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build scoped delete filters
    const scopeGroup = (query: any) => {
      let q = query.eq("group_id", groupId);
      if (sessionId) q = q.eq("session_id", sessionId);
      return q;
    };

    // 1. Delete group_court_state
    await scopeGroup(supabase.from("group_court_state").delete());

    // 2. Delete match_substitutions for this group
    await scopeGroup(supabase.from("match_substitutions").delete());

    // 3. Delete matches for this group
    await scopeGroup(supabase.from("matches").delete());

    // 4. Optionally clear guest players
    if (clearPlayers) {
      let playerDelete = supabase
        .from("players")
        .delete()
        .eq("group_id", groupId)
        .eq("is_guest", true);
      if (sessionId) playerDelete = playerDelete.eq("session_id", sessionId);
      await playerDelete;
    }

    // 5. Unlock group
    await supabase
      .from("court_groups")
      .update({
        is_locked: false,
        locked_at: null,
      })
      .eq("id", groupId);

    return new Response(
      JSON.stringify({ ok: true, message: "Group reset successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    console.error("Reset group error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, message: msg }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

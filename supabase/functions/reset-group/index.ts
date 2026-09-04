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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const userId = claims.claims.sub;
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

    const { groupId, sessionId, clearPlayers } = await req.json();
    if (!groupId || !sessionId) {
      return new Response(JSON.stringify({ ok: false, message: "Group ID and session ID are required" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Never reset a same-id group belonging to another run.
    const { data: group, error: groupError } = await supabase
      .from("court_groups")
      .select("id, session_id")
      .eq("id", groupId)
      .eq("session_id", sessionId)
      .maybeSingle();
    assertNoError("Group lookup failed", groupError);
    if (!group) throw new Error("Group not found in the active session.");

    const scopeGroup = (query: any) => query.eq("group_id", groupId).eq("session_id", sessionId);

    let result = await scopeGroup(supabase.from("group_court_state").delete());
    assertNoError("Deleting group court state failed", result.error);

    result = await scopeGroup(supabase.from("match_substitutions").delete());
    assertNoError("Deleting group substitutions failed", result.error);

    result = await scopeGroup(supabase.from("matches").delete());
    assertNoError("Deleting group matches failed", result.error);

    // rotation_audit currently has no group_id column, so group resets deliberately
    // leave it untouched rather than issuing an invalid/over-broad delete.

    if (clearPlayers) {
      const playerResult = await supabase
        .from("players")
        .delete()
        .eq("group_id", groupId)
        .eq("session_id", sessionId);
      assertNoError("Deleting group players failed", playerResult.error);
    }

    const { error: unlockError } = await supabase
      .from("court_groups")
      .update({ is_locked: false, locked_at: null })
      .eq("id", groupId)
      .eq("session_id", sessionId);
    assertNoError("Unlocking group failed", unlockError);

    const { error: unitUnlockError } = await supabase
      .from("court_units")
      .update({ is_locked: false })
      .eq("session_id", sessionId)
      .eq("court_group_id", groupId);
    assertNoError("Unlocking group court unit failed", unitUnlockError);

    return new Response(JSON.stringify({ ok: true, message: "Group reset successfully" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Reset group error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ ok: false, message: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

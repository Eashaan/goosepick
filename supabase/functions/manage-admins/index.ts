import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = claimsData.claims.sub as string;

    // Use service role for privileged operations
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Check caller is admin
    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();

    if (!callerRole) {
      return new Response(JSON.stringify({ error: "Forbidden: not an admin" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, email, user_id } = await req.json();

    // ── LIST ──
    if (action === "list") {
      const { data: roles, error } = await adminClient
        .from("user_roles")
        .select("user_id, role")
        .eq("role", "admin");

      if (error) throw error;

      // Lookup emails from auth.users
      const admins = [];
      for (const r of roles || []) {
        const { data: userData } = await adminClient.auth.admin.getUserById(r.user_id);
        admins.push({
          user_id: r.user_id,
          email: userData?.user?.email || "unknown",
        });
      }

      return new Response(JSON.stringify({ admins }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── ADD ──
    if (action === "add") {
      if (!email || typeof email !== "string") {
        return new Response(JSON.stringify({ error: "Email is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const trimmed = email.trim().toLowerCase();

      // Find user by email
      const { data: userList, error: listErr } = await adminClient.auth.admin.listUsers();
      if (listErr) throw listErr;

      const targetUser = (userList?.users || []).find(
        (u) => u.email?.toLowerCase() === trimmed
      );

      if (!targetUser) {
        return new Response(
          JSON.stringify({ error: "No account found with that email. The user must sign up first." }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if already admin
      const { data: existing } = await adminClient
        .from("user_roles")
        .select("id")
        .eq("user_id", targetUser.id)
        .eq("role", "admin")
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify({ error: "User is already an admin" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: insertErr } = await adminClient
        .from("user_roles")
        .insert({ user_id: targetUser.id, role: "admin" });

      if (insertErr) throw insertErr;

      return new Response(JSON.stringify({ ok: true, user_id: targetUser.id, email: trimmed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── REMOVE ──
    if (action === "remove") {
      if (!user_id || typeof user_id !== "string") {
        return new Response(JSON.stringify({ error: "user_id is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (user_id === callerId) {
        return new Response(JSON.stringify({ error: "You cannot remove yourself as admin" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: delErr } = await adminClient
        .from("user_roles")
        .delete()
        .eq("user_id", user_id)
        .eq("role", "admin");

      if (delErr) throw delErr;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

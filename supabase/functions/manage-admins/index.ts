import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STAFF_ROLES = ["owner", "admin", "host", "viewer"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];
const RANK: Record<string, number> = { owner: 1, admin: 2, host: 3, viewer: 4 };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Owner-only staff role management. One role per user; last owner is protected (also enforced by DB trigger). */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) return json({ error: "Unauthorized" }, 401);
    const callerId = claimsData.claims.sub as string;

    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerOwner } = await adminClient
      .from("user_roles").select("id").eq("user_id", callerId).eq("role", "owner").maybeSingle();
    if (!callerOwner) return json({ error: "Forbidden: only owners can manage roles" }, 403);

    const { action, email, user_id, role } = await req.json();

    const countOwners = async () => {
      const { count } = await adminClient.from("user_roles").select("id", { count: "exact", head: true }).eq("role", "owner");
      return count ?? 0;
    };
    const rolesOf = async (uid: string) => {
      const { data } = await adminClient.from("user_roles").select("role").eq("user_id", uid);
      return (data ?? []).map((r) => r.role as string);
    };

    if (action === "list") {
      const { data: rows, error } = await adminClient.from("user_roles").select("user_id, role");
      if (error) throw error;
      const best = new Map<string, string>();
      for (const r of rows ?? []) {
        const cur = best.get(r.user_id);
        if (!cur || (RANK[r.role] ?? 9) < (RANK[cur] ?? 9)) best.set(r.user_id, r.role);
      }
      const staff = [];
      for (const [uid, r] of best) {
        const { data: u } = await adminClient.auth.admin.getUserById(uid);
        staff.push({ user_id: uid, email: u?.user?.email || "unknown", role: r });
      }
      staff.sort((a, b) => (RANK[a.role] - RANK[b.role]) || a.email.localeCompare(b.email));
      // `admins` kept for backwards compatibility with older clients
      return json({ staff, admins: staff });
    }

    if (action === "set_role" || action === "add") {
      const newRole = (action === "add" ? role || "admin" : role) as StaffRole;
      if (!STAFF_ROLES.includes(newRole)) return json({ error: "Invalid role" }, 400);

      let targetId = typeof user_id === "string" ? user_id : null;
      if (!targetId) {
        if (!email || typeof email !== "string") return json({ error: "Email is required" }, 400);
        const trimmed = email.trim().toLowerCase();
        let found: { id: string } | undefined;
        for (let page = 1; page <= 20 && !found; page++) {
          const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
          if (error) throw error;
          found = (data?.users || []).find((u) => u.email?.toLowerCase() === trimmed);
          if (!data?.users?.length || data.users.length < 1000) break;
        }
        if (!found) return json({ error: "No account found with that email. The person must sign in once first." }, 404);
        targetId = found.id;
      }

      const current = await rolesOf(targetId);
      if (current.includes("owner") && newRole !== "owner" && (await countOwners()) <= 1) {
        return json({ error: "You can't demote the last owner. Make someone else owner first." }, 400);
      }

      if (!current.includes(newRole)) {
        const { error } = await adminClient.from("user_roles").insert({ user_id: targetId, role: newRole });
        if (error) throw error;
      }
      const others = current.filter((r) => r !== newRole);
      if (others.length) {
        const { error } = await adminClient.from("user_roles").delete().eq("user_id", targetId).in("role", others);
        if (error) throw error;
      }
      return json({ ok: true, user_id: targetId, role: newRole });
    }

    if (action === "remove") {
      if (!user_id || typeof user_id !== "string") return json({ error: "user_id is required" }, 400);
      if (user_id === callerId) return json({ error: "You cannot remove your own access" }, 400);
      const current = await rolesOf(user_id);
      if (current.includes("owner") && (await countOwners()) <= 1) {
        return json({ error: "You can't remove the last owner" }, 400);
      }
      const { error } = await adminClient.from("user_roles").delete().eq("user_id", user_id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message || "Internal error" }, 500);
  }
});

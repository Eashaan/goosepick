import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function esc(val: string | number | null | undefined): string {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(...vals: (string | number | null | undefined)[]): string {
  return vals.map(esc).join(",");
}

interface PlayerStat {
  name: string;
  matches: number;
  wins: number;
  pointDiff: number;
}

function computeLeaderboard(
  matchList: any[],
  playerMap: Map<string, string>
): { name: string; matches: number; wins: number; winPct: number; avgDiff: number; perfIndex: number }[] {
  const completed = matchList.filter((m) => m.status === "completed");
  const stats: Record<string, PlayerStat> = {};

  for (const m of completed) {
    const t1 = m.team1_score ?? 0;
    const t2 = m.team2_score ?? 0;
    const t1Won = t1 > t2;
    const t2Won = t2 > t1;

    for (const pid of [m.team1_player1_id, m.team1_player2_id]) {
      if (!pid) continue;
      if (!stats[pid]) stats[pid] = { name: playerMap.get(pid) || pid, matches: 0, wins: 0, pointDiff: 0 };
      stats[pid].matches++;
      if (t1Won) stats[pid].wins++;
      stats[pid].pointDiff += t1 - t2;
    }
    for (const pid of [m.team2_player1_id, m.team2_player2_id]) {
      if (!pid) continue;
      if (!stats[pid]) stats[pid] = { name: playerMap.get(pid) || pid, matches: 0, wins: 0, pointDiff: 0 };
      stats[pid].matches++;
      if (t2Won) stats[pid].wins++;
      stats[pid].pointDiff += t2 - t1;
    }
  }

  return Object.values(stats)
    .map((s) => ({
      ...s,
      winPct: s.matches > 0 ? (s.wins / s.matches) * 100 : 0,
      avgDiff: s.matches > 0 ? s.pointDiff / s.matches : 0,
      perfIndex: s.matches > 0 ? (s.wins / s.matches) * 70 + (s.pointDiff / s.matches) * 30 / 10 : 0,
    }))
    .sort((a, b) => b.perfIndex - a.perfIndex);
}

serve(async (req) => {
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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify admin using getUser
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userSupabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
    const db = createClient(supabaseUrl, supabaseServiceKey);

    const { data: roleData } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { sessionId } = await req.json();
    if (!sessionId) {
      return new Response(JSON.stringify({ error: "sessionId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: session } = await db.from("sessions").select("*").eq("id", sessionId).single();
    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [playersRes, matchesRes, courtsRes, groupsRes, unitsRes, feedbackRes] = await Promise.all([
      db.from("players").select("*").eq("session_id", sessionId),
      db.from("matches").select("*").eq("session_id", sessionId).order("global_match_index", { ascending: true }),
      db.from("courts").select("id, name").eq("session_id", sessionId),
      db.from("court_groups").select("id, court_ids").eq("session_id", sessionId),
      db.from("court_units").select("display_name, court_id, court_group_id, type, group_court_numbers")
        .eq("city_id", session.city_id)
        .eq("event_type", session.event_type),
      db.from("feedback").select("*").eq("session_id", sessionId),
    ]);

    const players = playersRes.data || [];
    const matches = matchesRes.data || [];
    const courts = courtsRes.data || [];
    let groups = groupsRes.data || [];
    const units = unitsRes.data || [];
    const feedback = feedbackRes.data || [];

    // Collect all group IDs referenced by matches/players that may not be in the session's court_groups
    const knownGroupIds = new Set(groups.map((g: any) => g.id));
    const missingGroupIds = new Set<string>();
    for (const m of matches) {
      if (m.group_id && !knownGroupIds.has(m.group_id)) missingGroupIds.add(m.group_id);
    }
    for (const p of players) {
      if (p.group_id && !knownGroupIds.has(p.group_id)) missingGroupIds.add(p.group_id);
    }

    // Fetch any missing groups by their IDs
    if (missingGroupIds.size > 0) {
      const { data: extraGroups } = await db
        .from("court_groups")
        .select("id, court_ids")
        .in("id", Array.from(missingGroupIds));
      if (extraGroups) {
        groups = [...groups, ...extraGroups];
      }
    }

    // Build maps
    const playerMap = new Map<string, string>();
    players.forEach((p: any) => playerMap.set(p.id, p.name));

    const courtMap = new Map<number, string>();
    courts.forEach((c: any) => courtMap.set(c.id, c.name));

    // Map group_id -> display_name
    const groupDisplayMap = new Map<string, string>();
    units.forEach((u: any) => {
      if (u.type === "group" && u.court_group_id) {
        groupDisplayMap.set(u.court_group_id, u.display_name);
      }
    });

    // Map court_id -> display_name for standalone courts
    const courtDisplayMap = new Map<number, string>();
    units.forEach((u: any) => {
      if (u.type === "standalone" && u.court_id != null) {
        courtDisplayMap.set(u.court_id, u.display_name);
      }
    });

    const pName = (id: string | null) => (id ? playerMap.get(id) || "" : "");

    // Build player lists per group and per court
    const groupPlayerMap = new Map<string, any[]>();
    const courtPlayerMap = new Map<number, any[]>();
    for (const p of players) {
      if (p.group_id) {
        if (!groupPlayerMap.has(p.group_id)) groupPlayerMap.set(p.group_id, []);
        groupPlayerMap.get(p.group_id)!.push(p);
      } else if (p.court_id) {
        if (!courtPlayerMap.has(p.court_id)) courtPlayerMap.set(p.court_id, []);
        courtPlayerMap.get(p.court_id)!.push(p);
      }
    }

    // Separate matches into groups and standalone courts
    const groupMatchMap = new Map<string, any[]>();
    const courtMatchMap = new Map<number, any[]>();
    for (const m of matches) {
      if (m.group_id) {
        if (!groupMatchMap.has(m.group_id)) groupMatchMap.set(m.group_id, []);
        groupMatchMap.get(m.group_id)!.push(m);
      } else {
        if (!courtMatchMap.has(m.court_id)) courtMatchMap.set(m.court_id, []);
        courtMatchMap.get(m.court_id)!.push(m);
      }
    }

    const lines: string[] = [];

    // Render a full section: players + match roster + leaderboard
    function renderSection(label: string, sectionPlayers: any[], sectionMatches: any[]) {
      lines.push(`=== ${label} ===`);
      lines.push("");

      // Players
      lines.push(`-- PLAYERS (${sectionPlayers.length}) --`);
      lines.push(row("Player Name"));
      for (const p of sectionPlayers) {
        lines.push(row(p.name));
      }
      lines.push("");

      // Match Roster
      lines.push("-- MATCH ROSTER --");
      lines.push(row("Match #", "Court #", "Team 1 Player 1", "Team 1 Player 2", "Team 2 Player 1", "Team 2 Player 2", "Team 1 Score", "Team 2 Score", "Status", "Started At", "Completed At"));
      for (const m of sectionMatches) {
        lines.push(row(
          (m.global_match_index ?? m.match_index) + 1,
          m.court_number ?? (courtMap.get(m.court_id) || m.court_id),
          pName(m.team1_player1_id),
          pName(m.team1_player2_id),
          pName(m.team2_player1_id),
          pName(m.team2_player2_id),
          m.team1_score,
          m.team2_score,
          m.status,
          m.started_at || "",
          m.completed_at || "",
        ));
      }
      lines.push("");

      // Leaderboard
      lines.push("-- LEADERBOARD --");
      lines.push(row("Rank", "Player", "Matches", "Wins", "Win %", "Avg Point Diff", "Performance Index"));
      const lb = computeLeaderboard(sectionMatches, playerMap);
      lb.forEach((p, i) => {
        lines.push(row(i + 1, p.name, p.matches, p.wins, p.winPct.toFixed(1) + "%", p.avgDiff.toFixed(2), p.perfIndex.toFixed(2)));
      });

      lines.push("");
      lines.push("");
    }

    // Render group sections
    for (const g of groups) {
      const gMatches = groupMatchMap.get(g.id) || [];
      const gPlayers = groupPlayerMap.get(g.id) || [];
      if (gMatches.length === 0 && gPlayers.length === 0) continue;
      const label = groupDisplayMap.get(g.id) || `Group (${g.court_ids.join(", ")})`;
      renderSection(label, gPlayers, gMatches);
    }

    // Render standalone court sections
    for (const [courtId, cMatches] of courtMatchMap) {
      const cPlayers = courtPlayerMap.get(courtId) || [];
      const label = courtDisplayMap.get(courtId) || courtMap.get(courtId) || `Court ${courtId}`;
      renderSection(label, cPlayers, cMatches);
    }

    // Feedback
    if (feedback.length > 0) {
      lines.push("=== FEEDBACK ===");
      lines.push(row("Player", "Rating", "Note", "Submitted At"));
      for (const f of feedback) {
        lines.push(row(pName(f.player_id) || f.player_id, f.rating, f.note || "", f.created_at));
      }
    }

    const csv = lines.join("\n");

    return new Response(csv, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="session-export.csv"`,
      },
    });
  } catch (error: unknown) {
    console.error("Export error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

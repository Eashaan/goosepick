import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function escapeCSV(val: string | number | null | undefined): string {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
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

    // Verify admin
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await userSupabase.auth.getClaims(token);
    if (claimsError || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Invalid auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claims.claims.sub;
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

    // Verify session exists
    const { data: session } = await db
      .from("sessions")
      .select("*")
      .eq("id", sessionId)
      .single();
    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get courts linked to this session
    const { data: courts } = await db
      .from("courts")
      .select("id, name")
      .eq("session_id", sessionId);
    const courtIds = (courts || []).map((c: any) => c.id);
    const courtMap = new Map<number, string>();
    (courts || []).forEach((c: any) => courtMap.set(c.id, c.name));

    if (courtIds.length === 0) {
      return new Response("No courts found for this session.", {
        headers: { ...corsHeaders, "Content-Type": "text/csv" },
      });
    }

    // Fetch players
    const { data: players } = await db
      .from("players")
      .select("*")
      .in("court_id", courtIds)
      .order("created_at", { ascending: true });
    const playerMap = new Map<string, string>();
    (players || []).forEach((p: any) => playerMap.set(p.id, p.name));

    // Fetch matches
    const { data: matches } = await db
      .from("matches")
      .select("*")
      .in("court_id", courtIds)
      .order("match_index", { ascending: true });

    // Fetch feedback
    const { data: feedback } = await db
      .from("feedback")
      .select("*")
      .in("court_id", courtIds);

    // ── Build CSV ──
    const sections: string[] = [];

    // MATCHES SHEET
    sections.push("=== MATCHES ===");
    sections.push(
      ["Match #", "Court", "Team 1 Player 1", "Team 1 Player 2", "Team 2 Player 1", "Team 2 Player 2", "Team 1 Score", "Team 2 Score", "Status", "Started At", "Completed At"]
        .map(escapeCSV)
        .join(",")
    );
    for (const m of matches || []) {
      sections.push(
        [
          m.match_index + 1,
          courtMap.get(m.court_id) || m.court_id,
          playerMap.get(m.team1_player1_id) || "",
          playerMap.get(m.team1_player2_id) || "",
          playerMap.get(m.team2_player1_id) || "",
          playerMap.get(m.team2_player2_id) || "",
          m.team1_score,
          m.team2_score,
          m.status,
          m.started_at || "",
          m.completed_at || "",
        ]
          .map(escapeCSV)
          .join(",")
      );
    }

    // LEADERBOARD SHEET
    sections.push("");
    sections.push("=== LEADERBOARD ===");
    sections.push(
      ["Rank", "Player", "Matches", "Wins", "Win %", "Avg Point Diff", "Performance Index"]
        .map(escapeCSV)
        .join(",")
    );

    // Compute leaderboard
    const completedMatches = (matches || []).filter((m: any) => m.status === "completed");
    const stats: Record<string, { name: string; matches: number; wins: number; pointDiff: number }> = {};
    for (const m of completedMatches) {
      const allPlayers = [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id].filter(Boolean);
      const t1Score = m.team1_score ?? 0;
      const t2Score = m.team2_score ?? 0;
      const t1Won = t1Score > t2Score;
      const t2Won = t2Score > t1Score;

      for (const pid of [m.team1_player1_id, m.team1_player2_id]) {
        if (!pid) continue;
        if (!stats[pid]) stats[pid] = { name: playerMap.get(pid) || pid, matches: 0, wins: 0, pointDiff: 0 };
        stats[pid].matches++;
        if (t1Won) stats[pid].wins++;
        stats[pid].pointDiff += t1Score - t2Score;
      }
      for (const pid of [m.team2_player1_id, m.team2_player2_id]) {
        if (!pid) continue;
        if (!stats[pid]) stats[pid] = { name: playerMap.get(pid) || pid, matches: 0, wins: 0, pointDiff: 0 };
        stats[pid].matches++;
        if (t2Won) stats[pid].wins++;
        stats[pid].pointDiff += t2Score - t1Score;
      }
    }

    const leaderboard = Object.values(stats)
      .map((s) => ({
        ...s,
        winPct: s.matches > 0 ? (s.wins / s.matches) * 100 : 0,
        avgDiff: s.matches > 0 ? s.pointDiff / s.matches : 0,
        perfIndex: s.matches > 0 ? ((s.wins / s.matches) * 70 + (s.pointDiff / s.matches) * 30 / 10) : 0,
      }))
      .sort((a, b) => b.perfIndex - a.perfIndex);

    leaderboard.forEach((p, i) => {
      sections.push(
        [i + 1, p.name, p.matches, p.wins, p.winPct.toFixed(1) + "%", p.avgDiff.toFixed(2), p.perfIndex.toFixed(2)]
          .map(escapeCSV)
          .join(",")
      );
    });

    // PLAYERS SHEET
    sections.push("");
    sections.push("=== PLAYERS ===");
    sections.push(["Player ID", "Name", "Court", "Created At"].map(escapeCSV).join(","));
    for (const p of players || []) {
      sections.push(
        [p.id, p.name, courtMap.get(p.court_id) || p.court_id, p.created_at]
          .map(escapeCSV)
          .join(",")
      );
    }

    // FEEDBACK SHEET
    if (feedback && feedback.length > 0) {
      sections.push("");
      sections.push("=== FEEDBACK ===");
      sections.push(["Player", "Rating", "Note", "Submitted At"].map(escapeCSV).join(","));
      for (const f of feedback) {
        sections.push(
          [playerMap.get(f.player_id) || f.player_id, f.rating, f.note || "", f.created_at]
            .map(escapeCSV)
            .join(",")
        );
      }
    }

    const csv = sections.join("\n");

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

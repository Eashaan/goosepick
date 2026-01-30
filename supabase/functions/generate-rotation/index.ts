import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Player {
  id: string;
  name: string;
}

interface Match {
  team1_player1_id: string;
  team1_player2_id: string;
  team2_player1_id: string;
  team2_player2_id: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { courtId } = await req.json();
    
    if (!courtId) {
      throw new Error("Court ID is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch players for this court
    const { data: players, error: playersError } = await supabase
      .from("players")
      .select("id, name")
      .eq("court_id", courtId)
      .order("created_at", { ascending: true });

    if (playersError) throw playersError;
    if (!players || players.length < 8 || players.length > 12) {
      throw new Error(`Invalid player count: ${players?.length || 0}. Must be 8-12 players.`);
    }

    // Generate rotation
    const matches = generateRotation(players);

    // Delete existing matches for this court
    await supabase.from("matches").delete().eq("court_id", courtId);

    // Insert new matches
    const matchInserts = matches.map((match, index) => ({
      court_id: courtId,
      match_index: index,
      team1_player1_id: match.team1_player1_id,
      team1_player2_id: match.team1_player2_id,
      team2_player1_id: match.team2_player1_id,
      team2_player2_id: match.team2_player2_id,
    }));

    const { error: insertError } = await supabase.from("matches").insert(matchInserts);
    if (insertError) throw insertError;

    // Reset court state
    const { error: stateError } = await supabase
      .from("court_state")
      .update({ current_match_index: 0, phase: "idle", updated_at: new Date().toISOString() })
      .eq("court_id", courtId);
    if (stateError) throw stateError;

    return new Response(
      JSON.stringify({ success: true, matchCount: matches.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error generating rotation:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function generateRotation(players: Player[]): Match[] {
  const n = players.length;
  const matches: Match[] = [];
  const partnerPairs = new Set<string>();
  const playerMatchCounts: Record<string, number> = {};
  const playerLastPlayed: Record<string, number> = {};
  
  players.forEach(p => {
    playerMatchCounts[p.id] = 0;
    playerLastPlayed[p.id] = -999;
  });

  const makePairKey = (a: string, b: string) => [a, b].sort().join("-");
  
  const hasPartnered = (a: string, b: string) => partnerPairs.has(makePairKey(a, b));
  
  const countOpponentMeetings = (team1: string[], team2: string[], opponentCounts: Record<string, number>) => {
    let count = 0;
    for (const p1 of team1) {
      for (const p2 of team2) {
        const key = makePairKey(p1, p2);
        count += opponentCounts[key] || 0;
      }
    }
    return count;
  };

  const opponentCounts: Record<string, number> = {};

  for (let matchIndex = 0; matchIndex < 17; matchIndex++) {
    // Get eligible players (not sat out more than 2 consecutive)
    const eligiblePlayers = players.filter(p => {
      const lastPlayed = playerLastPlayed[p.id];
      return matchIndex - lastPlayed <= 2;
    });

    // Sort by match count (ascending) to balance play time
    const sortedPlayers = [...players].sort((a, b) => {
      const aCount = playerMatchCounts[a.id];
      const bCount = playerMatchCounts[b.id];
      if (aCount !== bCount) return aCount - bCount;
      // Tie-breaker: who sat out longer
      return playerLastPlayed[a.id] - playerLastPlayed[b.id];
    });

    // Try to find 4 players for a valid match
    let bestMatch: Match | null = null;
    let bestScore = Infinity;

    // Try combinations of 4 players
    for (let i = 0; i < sortedPlayers.length && !bestMatch; i++) {
      for (let j = i + 1; j < sortedPlayers.length && !bestMatch; j++) {
        for (let k = j + 1; k < sortedPlayers.length && !bestMatch; k++) {
          for (let l = k + 1; l < sortedPlayers.length; l++) {
            const fourPlayers = [sortedPlayers[i], sortedPlayers[j], sortedPlayers[k], sortedPlayers[l]];
            
            // Check sit-out constraint for all 4
            const allEligible = fourPlayers.every(p => matchIndex - playerLastPlayed[p.id] <= 3);
            if (!allEligible) continue;

            // Try all team pairings (3 ways to split 4 into 2 pairs)
            const pairings = [
              [[0, 1], [2, 3]],
              [[0, 2], [1, 3]],
              [[0, 3], [1, 2]],
            ];

            for (const [[a, b], [c, d]] of pairings) {
              const team1 = [fourPlayers[a].id, fourPlayers[b].id];
              const team2 = [fourPlayers[c].id, fourPlayers[d].id];

              // Check no repeat partners
              if (hasPartnered(team1[0], team1[1])) continue;
              if (hasPartnered(team2[0], team2[1])) continue;

              // Score based on opponent repeats
              const score = countOpponentMeetings(team1, team2, opponentCounts);
              
              if (score < bestScore) {
                bestScore = score;
                bestMatch = {
                  team1_player1_id: team1[0],
                  team1_player2_id: team1[1],
                  team2_player1_id: team2[0],
                  team2_player2_id: team2[1],
                };
              }
            }
          }
        }
      }
    }

    if (!bestMatch) {
      // Fallback: just pick first 4 available, relax constraints
      const available = [...sortedPlayers].slice(0, 4);
      bestMatch = {
        team1_player1_id: available[0].id,
        team1_player2_id: available[1].id,
        team2_player1_id: available[2].id,
        team2_player2_id: available[3].id,
      };
    }

    // Record the match
    matches.push(bestMatch);
    
    // Update tracking
    const playersInMatch = [
      bestMatch.team1_player1_id,
      bestMatch.team1_player2_id,
      bestMatch.team2_player1_id,
      bestMatch.team2_player2_id,
    ];

    playersInMatch.forEach(pid => {
      playerMatchCounts[pid]++;
      playerLastPlayed[pid] = matchIndex;
    });

    // Record partnerships
    partnerPairs.add(makePairKey(bestMatch.team1_player1_id, bestMatch.team1_player2_id));
    partnerPairs.add(makePairKey(bestMatch.team2_player1_id, bestMatch.team2_player2_id));

    // Record opponent meetings
    const team1 = [bestMatch.team1_player1_id, bestMatch.team1_player2_id];
    const team2 = [bestMatch.team2_player1_id, bestMatch.team2_player2_id];
    for (const p1 of team1) {
      for (const p2 of team2) {
        const key = makePairKey(p1, p2);
        opponentCounts[key] = (opponentCounts[key] || 0) + 1;
      }
    }
  }

  return matches;
}

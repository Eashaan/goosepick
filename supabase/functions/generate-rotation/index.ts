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

    // Generate rotation with retry logic
    const result = generateFairRotation(players);
    
    if (!result.success) {
      throw new Error("Failed to generate fair rotation after maximum attempts");
    }

    // Delete existing matches for this court
    await supabase.from("matches").delete().eq("court_id", courtId);

    // Insert new matches with status field
    const matchInserts = result.matches.map((match, index) => ({
      court_id: courtId,
      match_index: index,
      team1_player1_id: match.team1_player1_id,
      team1_player2_id: match.team1_player2_id,
      team2_player1_id: match.team2_player1_id,
      team2_player2_id: match.team2_player2_id,
      status: "pending",
      override_played: false,
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
      JSON.stringify({ 
        success: true, 
        matchCount: result.matches.length,
        fallbackLevel: result.fallbackLevel,
        attempts: result.attempts
      }),
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

interface RotationResult {
  success: boolean;
  matches: Match[];
  fallbackLevel: number;
  attempts: number;
}

function generateFairRotation(players: Player[]): RotationResult {
  const MAX_ATTEMPTS = 50;
  const MATCH_COUNT = 17;
  
  // Try with strict constraints first, then progressively relax
  for (let fallbackLevel = 0; fallbackLevel <= 2; fallbackLevel++) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const result = tryGenerateRotation(players, MATCH_COUNT, fallbackLevel);
      if (result) {
        return {
          success: true,
          matches: result,
          fallbackLevel,
          attempts: attempt + 1
        };
      }
    }
  }
  
  return { success: false, matches: [], fallbackLevel: -1, attempts: MAX_ATTEMPTS * 3 };
}

function tryGenerateRotation(players: Player[], matchCount: number, fallbackLevel: number): Match[] | null {
  const n = players.length;
  const matches: Match[] = [];
  
  // Tracking structures
  const partnerPairs = new Set<string>();
  const playerMatchCounts: Record<string, number> = {};
  const playerLastPlayed: Record<string, number> = {};
  const opponentCounts: Record<string, number> = {};
  
  // Initialize
  players.forEach(p => {
    playerMatchCounts[p.id] = 0;
    playerLastPlayed[p.id] = -999;
  });
  
  const makePairKey = (a: string, b: string) => [a, b].sort().join("-");
  const hasPartnered = (a: string, b: string) => partnerPairs.has(makePairKey(a, b));
  
  // Calculate expected matches per player
  const totalPlayerSlots = matchCount * 4;
  const minMatches = Math.floor(totalPlayerSlots / n);
  const maxMatches = Math.ceil(totalPlayerSlots / n);
  
  for (let matchIndex = 0; matchIndex < matchCount; matchIndex++) {
    const candidates = findMatchCandidates(
      players,
      matchIndex,
      playerMatchCounts,
      playerLastPlayed,
      partnerPairs,
      opponentCounts,
      minMatches,
      maxMatches,
      fallbackLevel
    );
    
    if (candidates.length === 0) {
      return null; // Backtrack signal
    }
    
    // Shuffle candidates and pick the best one
    shuffleArray(candidates);
    const bestMatch = selectBestMatch(candidates, opponentCounts);
    
    if (!bestMatch) {
      return null;
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
  
  // Validate the rotation
  if (!validateRotation(matches, players, playerMatchCounts, playerLastPlayed, partnerPairs, fallbackLevel)) {
    return null;
  }
  
  return matches;
}

function findMatchCandidates(
  players: Player[],
  matchIndex: number,
  playerMatchCounts: Record<string, number>,
  playerLastPlayed: Record<string, number>,
  partnerPairs: Set<string>,
  opponentCounts: Record<string, number>,
  minMatches: number,
  maxMatches: number,
  fallbackLevel: number
): Match[] {
  const candidates: Match[] = [];
  const makePairKey = (a: string, b: string) => [a, b].sort().join("-");
  const hasPartnered = (a: string, b: string) => partnerPairs.has(makePairKey(a, b));
  
  // Prioritize players who need more matches
  const sortedPlayers = [...players].sort((a, b) => {
    const aCount = playerMatchCounts[a.id];
    const bCount = playerMatchCounts[b.id];
    if (aCount !== bCount) return aCount - bCount;
    return playerLastPlayed[a.id] - playerLastPlayed[b.id];
  });
  
  // Max sit-out constraint (2 in strict mode, 3 in fallback)
  const maxSitOut = fallbackLevel === 0 ? 2 : 3;
  
  // Filter eligible players
  const eligiblePlayers = sortedPlayers.filter(p => {
    const sitOutStreak = matchIndex - playerLastPlayed[p.id];
    // Must play if sitting out too long
    if (sitOutStreak > maxSitOut) return true;
    // Can't play back-to-back in strict mode
    if (fallbackLevel === 0 && playerLastPlayed[p.id] === matchIndex - 1) return false;
    return true;
  });
  
  // Must-play players (at max sit-out)
  const mustPlayPlayers = eligiblePlayers.filter(p => 
    matchIndex - playerLastPlayed[p.id] > maxSitOut
  );
  
  // If more than 4 must-play, we have a problem
  if (mustPlayPlayers.length > 4) {
    return [];
  }
  
  // Try combinations
  for (let i = 0; i < sortedPlayers.length; i++) {
    for (let j = i + 1; j < sortedPlayers.length; j++) {
      for (let k = j + 1; k < sortedPlayers.length; k++) {
        for (let l = k + 1; l < sortedPlayers.length; l++) {
          const fourPlayers = [sortedPlayers[i], sortedPlayers[j], sortedPlayers[k], sortedPlayers[l]];
          
          // Check all must-play players are included
          const includesAllMustPlay = mustPlayPlayers.every(mp => 
            fourPlayers.some(fp => fp.id === mp.id)
          );
          if (!includesAllMustPlay) continue;
          
          // Check sit-out constraint
          const allValidSitOut = fourPlayers.every(p => 
            matchIndex - playerLastPlayed[p.id] <= maxSitOut + 1
          );
          if (!allValidSitOut) continue;
          
          // Check back-to-back constraint in strict mode
          if (fallbackLevel === 0) {
            const hasBackToBack = fourPlayers.some(p => 
              playerLastPlayed[p.id] === matchIndex - 1
            );
            if (hasBackToBack) continue;
          }
          
          // Check balance constraint
          const wouldExceedMax = fourPlayers.some(p => 
            playerMatchCounts[p.id] >= maxMatches
          );
          if (wouldExceedMax && fallbackLevel === 0) continue;
          
          // Try all team pairings
          const pairings = [
            [[0, 1], [2, 3]],
            [[0, 2], [1, 3]],
            [[0, 3], [1, 2]],
          ];

          for (const [[a, b], [c, d]] of pairings) {
            const team1 = [fourPlayers[a].id, fourPlayers[b].id];
            const team2 = [fourPlayers[c].id, fourPlayers[d].id];

            // Check no repeat partners (always enforced except fallback 2)
            if (fallbackLevel < 2) {
              if (hasPartnered(team1[0], team1[1])) continue;
              if (hasPartnered(team2[0], team2[1])) continue;
            }

            candidates.push({
              team1_player1_id: team1[0],
              team1_player2_id: team1[1],
              team2_player1_id: team2[0],
              team2_player2_id: team2[1],
            });
          }
        }
      }
    }
  }
  
  return candidates;
}

function selectBestMatch(candidates: Match[], opponentCounts: Record<string, number>): Match | null {
  if (candidates.length === 0) return null;
  
  const makePairKey = (a: string, b: string) => [a, b].sort().join("-");
  
  // Score by opponent repeats (lower is better)
  let bestMatch = candidates[0];
  let bestScore = Infinity;
  
  for (const match of candidates) {
    const team1 = [match.team1_player1_id, match.team1_player2_id];
    const team2 = [match.team2_player1_id, match.team2_player2_id];
    
    let score = 0;
    for (const p1 of team1) {
      for (const p2 of team2) {
        score += opponentCounts[makePairKey(p1, p2)] || 0;
      }
    }
    
    if (score < bestScore) {
      bestScore = score;
      bestMatch = match;
    }
  }
  
  return bestMatch;
}

function validateRotation(
  matches: Match[],
  players: Player[],
  playerMatchCounts: Record<string, number>,
  playerLastPlayed: Record<string, number>,
  partnerPairs: Set<string>,
  fallbackLevel: number
): boolean {
  // Check balance constraint
  const counts = Object.values(playerMatchCounts);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const maxDiff = fallbackLevel === 0 ? 1 : 2;
  
  if (maxCount - minCount > maxDiff) {
    return false;
  }
  
  // Check for repeat partners in strict mode
  if (fallbackLevel < 2) {
    const allPairs: string[] = [];
    const makePairKey = (a: string, b: string) => [a, b].sort().join("-");
    
    for (const match of matches) {
      const pair1 = makePairKey(match.team1_player1_id, match.team1_player2_id);
      const pair2 = makePairKey(match.team2_player1_id, match.team2_player2_id);
      
      if (allPairs.includes(pair1) || allPairs.includes(pair2)) {
        return false;
      }
      allPairs.push(pair1, pair2);
    }
  }
  
  return true;
}

function shuffleArray<T>(array: T[]): void {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

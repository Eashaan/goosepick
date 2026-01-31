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

interface Diagnostics {
  player_count: number;
  matches_per_court: number;
  min_matches_per_player: number;
  max_matches_per_player: number;
  max_sitout_streak: number;
  repeat_partner_count: number;
  back_to_back_count: number;
  attempts_full: number;
  attempts_fallback1: number;
  attempts_fallback2: number;
  used_seed: number;
  note?: string;
}

interface GenerationResult {
  ok: boolean;
  generation_mode: "full" | "fallback1" | "fallback2";
  diagnostics: Diagnostics;
  matches: Match[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { courtId } = await req.json();
    
    if (!courtId) {
      return new Response(
        JSON.stringify({ ok: false, error: "Court ID is required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

    if (playersError) {
      console.error("Database error fetching players:", playersError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to fetch players" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    if (!players || players.length < 8 || players.length > 12) {
      return new Response(
        JSON.stringify({ ok: false, error: `Invalid player count: ${players?.length || 0}. Must be 8-12 players.` }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate rotation - this will ALWAYS succeed
    const result = generateRotationWithFallbacks(players);
    
    console.log("Generation result:", JSON.stringify({
      mode: result.generation_mode,
      diagnostics: result.diagnostics
    }));

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
    if (insertError) {
      console.error("Database error inserting matches:", insertError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to save rotation" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reset court state
    const { error: stateError } = await supabase
      .from("court_state")
      .update({ current_match_index: 0, phase: "idle", updated_at: new Date().toISOString() })
      .eq("court_id", courtId);
    
    if (stateError) {
      console.error("Database error updating court state:", stateError);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Main entry: tries full, fallback1, fallback2, then emergency
function generateRotationWithFallbacks(players: Player[]): GenerationResult {
  const MATCH_COUNT = 17;
  const seed = Date.now();
  
  const baseDiagnostics: Diagnostics = {
    player_count: players.length,
    matches_per_court: MATCH_COUNT,
    min_matches_per_player: 0,
    max_matches_per_player: 0,
    max_sitout_streak: 0,
    repeat_partner_count: 0,
    back_to_back_count: 0,
    attempts_full: 0,
    attempts_fallback1: 0,
    attempts_fallback2: 0,
    used_seed: seed,
  };

  // Try FULL mode (20 attempts)
  for (let attempt = 0; attempt < 20; attempt++) {
    baseDiagnostics.attempts_full++;
    const result = tryGenerateSchedule(players, MATCH_COUNT, "full", seed + attempt);
    if (result) {
      const diag = computeDiagnostics(result, players, baseDiagnostics);
      return { ok: true, generation_mode: "full", diagnostics: diag, matches: result };
    }
  }

  console.log("Full mode failed, trying fallback1...");

  // Try FALLBACK1 (20 attempts)
  for (let attempt = 0; attempt < 20; attempt++) {
    baseDiagnostics.attempts_fallback1++;
    const result = tryGenerateSchedule(players, MATCH_COUNT, "fallback1", seed + 100 + attempt);
    if (result) {
      const diag = computeDiagnostics(result, players, baseDiagnostics);
      return { ok: true, generation_mode: "fallback1", diagnostics: diag, matches: result };
    }
  }

  console.log("Fallback1 failed, trying fallback2...");

  // Try FALLBACK2 (20 attempts)
  for (let attempt = 0; attempt < 20; attempt++) {
    baseDiagnostics.attempts_fallback2++;
    const result = tryGenerateSchedule(players, MATCH_COUNT, "fallback2", seed + 200 + attempt);
    if (result) {
      const diag = computeDiagnostics(result, players, baseDiagnostics);
      return { ok: true, generation_mode: "fallback2", diagnostics: diag, matches: result };
    }
  }

  console.log("All modes failed, generating emergency schedule...");

  // Emergency: always succeeds with basic constraints
  const emergency = generateEmergencySchedule(players, MATCH_COUNT, seed);
  baseDiagnostics.note = "emergency_basic_used";
  const diag = computeDiagnostics(emergency, players, baseDiagnostics);
  return { ok: true, generation_mode: "fallback2", diagnostics: diag, matches: emergency };
}

type Mode = "full" | "fallback1" | "fallback2";

function tryGenerateSchedule(players: Player[], matchCount: number, mode: Mode, seed: number): Match[] | null {
  const n = players.length;
  const totalSlots = matchCount * 4;
  const targetBase = Math.floor(totalSlots / n);
  const remainder = totalSlots % n;
  
  // Calculate target matches for each player
  const playerTargets: Record<string, number> = {};
  const shuffledPlayers = seededShuffle([...players], seed);
  shuffledPlayers.forEach((p, i) => {
    playerTargets[p.id] = i < remainder ? targetBase + 1 : targetBase;
  });

  // State tracking
  const matchesPlayed: Record<string, number> = {};
  const lastPlayedMatch: Record<string, number> = {};
  const sitoutStreak: Record<string, number> = {};
  const partnerPairs = new Set<string>();
  const opponentCounts: Record<string, number> = {};
  
  players.forEach(p => {
    matchesPlayed[p.id] = 0;
    lastPlayedMatch[p.id] = -999;
    sitoutStreak[p.id] = 0;
  });

  const makePairKey = (a: string, b: string) => [a, b].sort().join("-");
  const matches: Match[] = [];

  // Constraints by mode
  const allowBackToBack = mode !== "full";
  const allowRepeatPartners = mode === "fallback2";
  const maxBalanceDiff = mode === "fallback2" ? 2 : 1;
  const maxSitout = 2;

  for (let matchIndex = 0; matchIndex < matchCount; matchIndex++) {
    // Update sitout streaks
    players.forEach(p => {
      if (lastPlayedMatch[p.id] === matchIndex - 1) {
        sitoutStreak[p.id] = 0;
      } else if (matchIndex > 0) {
        sitoutStreak[p.id]++;
      }
    });

    // Build eligible players list
    const eligible: Player[] = [];
    const mustPlay: Player[] = [];

    for (const p of players) {
      const playedLast = lastPlayedMatch[p.id] === matchIndex - 1;
      const atTarget = matchesPlayed[p.id] >= playerTargets[p.id];
      const criticalSitout = sitoutStreak[p.id] >= maxSitout;

      // Must play if critical sitout
      if (criticalSitout && !atTarget) {
        mustPlay.push(p);
        eligible.push(p);
        continue;
      }

      // Skip if at target already
      if (atTarget) continue;

      // In full mode, skip if played last match
      if (!allowBackToBack && playedLast) continue;

      eligible.push(p);
    }

    // If more than 4 must-play, we have a problem
    if (mustPlay.length > 4) {
      return null;
    }

    // Try to find valid 4-player combination
    const selectedPlayers = selectFourPlayers(
      eligible,
      mustPlay,
      matchesPlayed,
      playerTargets,
      sitoutStreak,
      lastPlayedMatch,
      matchIndex,
      allowBackToBack,
      seed + matchIndex
    );

    if (!selectedPlayers || selectedPlayers.length !== 4) {
      return null;
    }

    // Try to form valid teams
    const teams = formTeams(
      selectedPlayers,
      partnerPairs,
      opponentCounts,
      allowRepeatPartners,
      makePairKey
    );

    if (!teams) {
      return null;
    }

    // Record the match
    const match: Match = {
      team1_player1_id: teams.team1[0],
      team1_player2_id: teams.team1[1],
      team2_player1_id: teams.team2[0],
      team2_player2_id: teams.team2[1],
    };
    matches.push(match);

    // Update state
    for (const pid of selectedPlayers.map(p => p.id)) {
      matchesPlayed[pid]++;
      lastPlayedMatch[pid] = matchIndex;
      sitoutStreak[pid] = 0;
    }

    partnerPairs.add(makePairKey(teams.team1[0], teams.team1[1]));
    partnerPairs.add(makePairKey(teams.team2[0], teams.team2[1]));

    for (const p1 of teams.team1) {
      for (const p2 of teams.team2) {
        const key = makePairKey(p1, p2);
        opponentCounts[key] = (opponentCounts[key] || 0) + 1;
      }
    }
  }

  // Validate final balance
  const counts = Object.values(matchesPlayed);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  if (maxCount - minCount > maxBalanceDiff) {
    return null;
  }

  return matches;
}

function selectFourPlayers(
  eligible: Player[],
  mustPlay: Player[],
  matchesPlayed: Record<string, number>,
  playerTargets: Record<string, number>,
  sitoutStreak: Record<string, number>,
  lastPlayedMatch: Record<string, number>,
  matchIndex: number,
  allowBackToBack: boolean,
  seed: number
): Player[] | null {
  if (eligible.length < 4) return null;

  // Score each player (higher = more urgent to play)
  const scored = eligible.map(p => {
    let score = 0;
    
    // Critical: must play gets highest priority
    if (mustPlay.some(mp => mp.id === p.id)) {
      score += 1000;
    }
    
    // High sitout streak
    score += sitoutStreak[p.id] * 100;
    
    // Behind on target
    const behind = playerTargets[p.id] - matchesPlayed[p.id];
    score += behind * 50;
    
    // Penalize back-to-back slightly even when allowed
    if (lastPlayedMatch[p.id] === matchIndex - 1) {
      score -= 20;
    }
    
    return { player: p, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Select top 4, ensuring all must-play are included
  const selected: Player[] = [];
  const mustPlayIds = new Set(mustPlay.map(p => p.id));

  // First add all must-play players
  for (const mp of mustPlay) {
    selected.push(mp);
  }

  // Then add highest scored non-must-play until we have 4
  for (const { player } of scored) {
    if (selected.length >= 4) break;
    if (!mustPlayIds.has(player.id)) {
      selected.push(player);
    }
  }

  if (selected.length < 4) return null;

  return selected.slice(0, 4);
}

function formTeams(
  fourPlayers: Player[],
  partnerPairs: Set<string>,
  opponentCounts: Record<string, number>,
  allowRepeatPartners: boolean,
  makePairKey: (a: string, b: string) => string
): { team1: [string, string]; team2: [string, string] } | null {
  const ids = fourPlayers.map(p => p.id);
  
  // All 3 possible pairings
  const pairings: [[number, number], [number, number]][] = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ];

  let bestPairing: { team1: [string, string]; team2: [string, string] } | null = null;
  let bestScore = Infinity;

  for (const [[a, b], [c, d]] of pairings) {
    const team1: [string, string] = [ids[a], ids[b]];
    const team2: [string, string] = [ids[c], ids[d]];

    // Check partner repeat constraint
    const pair1Used = partnerPairs.has(makePairKey(team1[0], team1[1]));
    const pair2Used = partnerPairs.has(makePairKey(team2[0], team2[1]));

    if (!allowRepeatPartners && (pair1Used || pair2Used)) {
      continue;
    }

    // Calculate opponent repeat score
    let oppScore = 0;
    for (const p1 of team1) {
      for (const p2 of team2) {
        oppScore += opponentCounts[makePairKey(p1, p2)] || 0;
      }
    }

    // Penalize partner repeats even when allowed
    if (pair1Used) oppScore += 10;
    if (pair2Used) oppScore += 10;

    if (oppScore < bestScore) {
      bestScore = oppScore;
      bestPairing = { team1, team2 };
    }
  }

  return bestPairing;
}

// Emergency schedule: guaranteed to work, just ensures 4 distinct players per match
function generateEmergencySchedule(players: Player[], matchCount: number, seed: number): Match[] {
  const n = players.length;
  const totalSlots = matchCount * 4;
  const targetBase = Math.floor(totalSlots / n);
  const remainder = totalSlots % n;
  
  const playerTargets: Record<string, number> = {};
  const shuffled = seededShuffle([...players], seed);
  shuffled.forEach((p, i) => {
    playerTargets[p.id] = i < remainder ? targetBase + 1 : targetBase;
  });

  const matchesPlayed: Record<string, number> = {};
  players.forEach(p => matchesPlayed[p.id] = 0);

  const matches: Match[] = [];

  for (let i = 0; i < matchCount; i++) {
    // Sort players by how far behind they are
    const sorted = [...players].sort((a, b) => {
      const aBehind = playerTargets[a.id] - matchesPlayed[a.id];
      const bBehind = playerTargets[b.id] - matchesPlayed[b.id];
      return bBehind - aBehind;
    });

    // Pick top 4 who haven't exceeded their target
    const selected = sorted
      .filter(p => matchesPlayed[p.id] < playerTargets[p.id])
      .slice(0, 4);

    // If not enough, just take top 4 overall
    while (selected.length < 4) {
      const next = sorted.find(p => !selected.some(s => s.id === p.id));
      if (next) selected.push(next);
      else break;
    }

    if (selected.length < 4) {
      // Should never happen, but fallback to first 4
      const fallback = players.slice(0, 4);
      matches.push({
        team1_player1_id: fallback[0].id,
        team1_player2_id: fallback[1].id,
        team2_player1_id: fallback[2].id,
        team2_player2_id: fallback[3].id,
      });
    } else {
      matches.push({
        team1_player1_id: selected[0].id,
        team1_player2_id: selected[1].id,
        team2_player1_id: selected[2].id,
        team2_player2_id: selected[3].id,
      });
      selected.forEach(p => matchesPlayed[p.id]++);
    }
  }

  return matches;
}

function computeDiagnostics(matches: Match[], players: Player[], base: Diagnostics): Diagnostics {
  const matchesPlayed: Record<string, number> = {};
  const lastPlayed: Record<string, number> = {};
  const partnerPairs = new Set<string>();
  let backToBackCount = 0;
  let maxSitout = 0;

  players.forEach(p => {
    matchesPlayed[p.id] = 0;
    lastPlayed[p.id] = -999;
  });

  const makePairKey = (a: string, b: string) => [a, b].sort().join("-");

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const playersInMatch = [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id];

    for (const pid of playersInMatch) {
      if (lastPlayed[pid] === i - 1) {
        backToBackCount++;
      }
      matchesPlayed[pid]++;
      
      // Track max sitout
      if (lastPlayed[pid] >= 0) {
        const gap = i - lastPlayed[pid] - 1;
        if (gap > maxSitout) maxSitout = gap;
      }
      
      lastPlayed[pid] = i;
    }

    // Track partner pairs
    const pair1 = makePairKey(m.team1_player1_id, m.team1_player2_id);
    const pair2 = makePairKey(m.team2_player1_id, m.team2_player2_id);
    partnerPairs.add(pair1);
    partnerPairs.add(pair2);
  }

  // Count repeat partners
  const allPairs: string[] = [];
  let repeatPartnerCount = 0;
  for (const m of matches) {
    const pair1 = makePairKey(m.team1_player1_id, m.team1_player2_id);
    const pair2 = makePairKey(m.team2_player1_id, m.team2_player2_id);
    if (allPairs.includes(pair1)) repeatPartnerCount++;
    else allPairs.push(pair1);
    if (allPairs.includes(pair2)) repeatPartnerCount++;
    else allPairs.push(pair2);
  }

  const counts = Object.values(matchesPlayed);

  return {
    ...base,
    min_matches_per_player: Math.min(...counts),
    max_matches_per_player: Math.max(...counts),
    max_sitout_streak: maxSitout,
    repeat_partner_count: repeatPartnerCount,
    back_to_back_count: backToBackCount,
  };
}

// Seeded random shuffle
function seededShuffle<T>(array: T[], seed: number): T[] {
  const result = [...array];
  let s = seed;
  
  const random = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  
  return result;
}

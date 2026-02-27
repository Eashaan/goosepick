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
  used_seed: number;
  generation_mode: string;
  note?: string;
}

interface GenerationResult {
  ok: boolean;
  generation_mode: string;
  diagnostics: Diagnostics;
  matches: Match[];
}

// Template match format: [team1_p1_label, team1_p2_label, team2_p1_label, team2_p2_label]
type TemplateMatch = [string, string, string, string];

// Hard-coded templates for N=9, N=10, N=11
const TEMPLATES: Record<number, TemplateMatch[]> = {
  9: [
    ["A", "B", "C", "D"], // M01
    ["E", "F", "G", "H"], // M02
    ["I", "A", "B", "C"], // M03
    ["D", "E", "F", "G"], // M04
    ["H", "I", "A", "D"], // M05
    ["B", "E", "C", "F"], // M06
    ["G", "I", "H", "D"], // M07
    ["A", "E", "B", "F"], // M08
    ["C", "G", "D", "H"], // M09
    ["I", "E", "A", "F"], // M10
    ["B", "G", "C", "H"], // M11
    ["D", "I", "E", "H"], // M12
    ["A", "G", "B", "H"], // M13
    ["C", "I", "D", "F"], // M14
    ["E", "G", "F", "H"], // M15
    ["A", "I", "B", "D"], // M16
    ["C", "E", "F", "G"], // M17
  ],
  10: [
    ["A", "B", "C", "D"], // M01
    ["E", "F", "G", "H"], // M02
    ["I", "A", "J", "C"], // M03
    ["B", "E", "D", "F"], // M04
    ["G", "I", "H", "J"], // M05
    ["A", "E", "C", "F"], // M06
    ["B", "G", "D", "H"], // M07
    ["I", "E", "J", "F"], // M08
    ["A", "G", "C", "H"], // M09
    ["B", "I", "D", "J"], // M10
    ["E", "G", "F", "H"], // M11
    ["A", "I", "C", "J"], // M12
    ["B", "E", "D", "F"], // M13 - potential repeat, repair will fix
    ["G", "I", "H", "J"], // M14 - potential repeat, repair will fix
    ["A", "F", "C", "E"], // M15
    ["B", "H", "D", "G"], // M16
    ["E", "I", "F", "J"], // M17
  ],
  11: [
    ["A", "B", "C", "D"], // M01
    ["E", "F", "G", "H"], // M02
    ["I", "J", "K", "A"], // M03
    ["B", "E", "C", "F"], // M04
    ["D", "G", "H", "I"], // M05
    ["J", "B", "K", "C"], // M06
    ["A", "E", "D", "F"], // M07
    ["G", "J", "H", "K"], // M08
    ["B", "I", "C", "G"], // M09
    ["A", "H", "D", "J"], // M10
    ["E", "I", "F", "K"], // M11
    ["B", "H", "C", "J"], // M12
    ["A", "G", "D", "K"], // M13
    ["E", "J", "F", "H"], // M14
    ["B", "G", "C", "I"], // M15
    ["A", "F", "D", "E"], // M16
    ["H", "J", "I", "K"], // M17
  ],
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authentication check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsError } = await userSupabase.auth.getClaims(token);
    
    if (claimsError || !claims?.claims?.sub) {
      console.error("Auth error:", claimsError);
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid authentication" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claims.claims.sub;
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: roleData, error: roleError } = await serviceSupabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !roleData) {
      console.error("Role check error:", roleError);
      return new Response(
        JSON.stringify({ ok: false, error: "Insufficient permissions" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { courtId, sessionId } = await req.json();
    
    if (!courtId) {
      return new Response(
        JSON.stringify({ ok: false, error: "Court ID is required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = serviceSupabase;

    // Resolve session_id: use passed sessionId, fallback to courts.session_id
    let resolvedSessionId = sessionId || null;
    if (!resolvedSessionId) {
      const { data: courtForSession } = await supabase
        .from("courts")
        .select("session_id")
        .eq("id", courtId)
        .maybeSingle();
      resolvedSessionId = courtForSession?.session_id || null;
    }

    // Fetch players for this court scoped to session
    let playersQuery = supabase
      .from("players")
      .select("id, name")
      .eq("court_id", courtId)
      .order("created_at", { ascending: true });
    if (resolvedSessionId) {
      playersQuery = playersQuery.eq("session_id", resolvedSessionId);
    }
    const { data: players, error: playersError } = await playersQuery;

    // Insert new matches
    const matchInserts = result.matches.map((match, index) => ({
      court_id: courtId,
      match_index: index,
      team1_player1_id: match.team1_player1_id,
      team1_player2_id: match.team1_player2_id,
      team2_player1_id: match.team2_player1_id,
      team2_player2_id: match.team2_player2_id,
      status: "pending",
      override_played: false,
      session_id: sessionId,
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

    // === ROTATION AUDIT ===
    try {
      // Compute opponent repeats
      const opponentCounts: Record<string, number> = {};
      const makePairKey = (a: string, b: string) => [a, b].sort().join("-");
      for (const m of result.matches) {
        const team1 = [m.team1_player1_id, m.team1_player2_id];
        const team2 = [m.team2_player1_id, m.team2_player2_id];
        for (const p1 of team1) {
          for (const p2 of team2) {
            const key = makePairKey(p1, p2);
            opponentCounts[key] = (opponentCounts[key] || 0) + 1;
          }
        }
      }
      let repeatOpponentCount = 0;
      for (const count of Object.values(opponentCounts)) {
        if (count > 1) repeatOpponentCount += count - 1;
      }

      // Compute fairness score
      const diag = result.diagnostics;
      let fairnessScore = 100;
      if (diag.max_matches_per_player - diag.min_matches_per_player > 1) fairnessScore -= 10;
      if (diag.max_sitout_streak > 2) fairnessScore -= 10;
      fairnessScore -= diag.repeat_partner_count * 2;
      fairnessScore -= repeatOpponentCount * 1;
      fairnessScore = Math.max(0, fairnessScore);

      // Get session_id from court
      const { data: courtRow } = await supabase
        .from("courts")
        .select("session_id")
        .eq("id", courtId)
        .maybeSingle();

      // Delete old audit for this court
      await supabase.from("rotation_audit").delete().eq("court_id", courtId);

      await supabase.from("rotation_audit").insert({
        session_id: courtRow?.session_id || null,
        court_id: courtId,
        total_players: n,
        matches_per_player_min: diag.min_matches_per_player,
        matches_per_player_max: diag.max_matches_per_player,
        max_consecutive_sitouts: diag.max_sitout_streak,
        repeat_partner_count: diag.repeat_partner_count,
        repeat_opponent_count: repeatOpponentCount,
        fairness_score: fairnessScore,
      });

      console.log("Rotation audit stored:", { fairnessScore, repeatOpponentCount });
    } catch (auditErr) {
      console.error("Audit storage warning (non-blocking):", auditErr);
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

// Main generation function
function generateRotation(players: Player[], n: number): GenerationResult {
  const MATCH_COUNT = 17;
  const seed = Date.now();
  
  // Use template-based for N=9,10,11; heuristic for N=8,12
  if (n >= 9 && n <= 11 && TEMPLATES[n]) {
    return generateFromTemplate(players, n, seed);
  } else {
    return generateHeuristic(players, n, seed);
  }
}

// Template-based generation with repair engine
function generateFromTemplate(players: Player[], n: number, seed: number): GenerationResult {
  const MATCH_COUNT = 17;
  const template = TEMPLATES[n];
  
  // Create label -> player_id mapping (A=0, B=1, etc.)
  const labels = "ABCDEFGHIJK".split("").slice(0, n);
  const labelToId: Record<string, string> = {};
  labels.forEach((label, i) => {
    labelToId[label] = players[i].id;
  });
  
  // Convert template to matches with player IDs
  let matches: Match[] = template.map(([t1p1, t1p2, t2p1, t2p2]) => ({
    team1_player1_id: labelToId[t1p1],
    team1_player2_id: labelToId[t1p2],
    team2_player1_id: labelToId[t2p1],
    team2_player2_id: labelToId[t2p2],
  }));
  
  // Run constraint validation
  let validation = validateConstraints(matches, players);
  let generationMode = "template";
  let note: string | undefined;
  
  // If partner repeats exist, run repair engine
  if (validation.partnerRepeats > 0) {
    console.log(`Template has ${validation.partnerRepeats} partner repeats, running repair...`);
    const repaired = repairSchedule(matches, players);
    matches = repaired.matches;
    validation = validateConstraints(matches, players);
    
    if (validation.partnerRepeats === 0) {
      generationMode = "template_repaired";
    } else {
      generationMode = "fallback_partner";
      note = `Rotation generated with ${validation.partnerRepeats} minimal partner repeat(s) due to constraints.`;
    }
  }
  
  // Check other hard constraints
  if (validation.backToBackCount > 0) {
    console.log(`Warning: ${validation.backToBackCount} back-to-back violations`);
  }
  if (validation.maxSitout > 2) {
    console.log(`Warning: max sitout streak is ${validation.maxSitout}`);
  }
  
  const diagnostics: Diagnostics = {
    player_count: n,
    matches_per_court: MATCH_COUNT,
    min_matches_per_player: validation.minMatches,
    max_matches_per_player: validation.maxMatches,
    max_sitout_streak: validation.maxSitout,
    repeat_partner_count: validation.partnerRepeats,
    back_to_back_count: validation.backToBackCount,
    used_seed: seed,
    generation_mode: generationMode,
    note,
  };
  
  return { ok: true, generation_mode: generationMode, diagnostics, matches };
}

// Constraint validation
interface ValidationResult {
  partnerRepeats: number;
  partnerRepeatPairs: string[];
  backToBackCount: number;
  maxSitout: number;
  minMatches: number;
  maxMatches: number;
  isBalanced: boolean;
}

function validateConstraints(matches: Match[], players: Player[]): ValidationResult {
  const n = players.length;
  const matchesPlayed: Record<string, number> = {};
  const lastPlayedMatch: Record<string, number> = {};
  const partnerCounts: Record<string, number> = {};
  let backToBackCount = 0;
  let maxSitout = 0;
  
  players.forEach(p => {
    matchesPlayed[p.id] = 0;
    lastPlayedMatch[p.id] = -999;
  });
  
  const makePairKey = (a: string, b: string) => [a, b].sort().join("-");
  
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const playersInMatch = [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id];
    
    // Track back-to-back
    for (const pid of playersInMatch) {
      if (lastPlayedMatch[pid] === i - 1) {
        backToBackCount++;
      }
      
      // Track max sitout
      if (lastPlayedMatch[pid] >= 0) {
        const gap = i - lastPlayedMatch[pid] - 1;
        if (gap > maxSitout) maxSitout = gap;
      }
      
      matchesPlayed[pid]++;
      lastPlayedMatch[pid] = i;
    }
    
    // Track partner pairs
    const pair1 = makePairKey(m.team1_player1_id, m.team1_player2_id);
    const pair2 = makePairKey(m.team2_player1_id, m.team2_player2_id);
    partnerCounts[pair1] = (partnerCounts[pair1] || 0) + 1;
    partnerCounts[pair2] = (partnerCounts[pair2] || 0) + 1;
  }
  
  // Count partner repeats
  let partnerRepeats = 0;
  const partnerRepeatPairs: string[] = [];
  for (const [pair, count] of Object.entries(partnerCounts)) {
    if (count > 1) {
      partnerRepeats += count - 1;
      partnerRepeatPairs.push(pair);
    }
  }
  
  const counts = Object.values(matchesPlayed);
  const minMatches = Math.min(...counts);
  const maxMatches = Math.max(...counts);
  
  // Check balance
  const totalSlots = 17 * 4;
  const targetBase = Math.floor(totalSlots / n);
  const isBalanced = maxMatches - minMatches <= 1;
  
  return {
    partnerRepeats,
    partnerRepeatPairs,
    backToBackCount,
    maxSitout,
    minMatches,
    maxMatches,
    isBalanced,
  };
}

// Repair engine to fix partner repeats
function repairSchedule(matches: Match[], players: Player[]): { matches: Match[]; improved: boolean } {
  const makePairKey = (a: string, b: string) => [a, b].sort().join("-");
  let currentMatches = matches.map(m => ({ ...m }));
  let improved = false;
  const MAX_ITERATIONS = 50;
  
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const validation = validateConstraints(currentMatches, players);
    
    if (validation.partnerRepeats === 0) {
      improved = true;
      break;
    }
    
    // Find matches with repeated partner pairs
    const partnerCounts: Record<string, number[]> = {}; // pair -> match indices
    
    for (let i = 0; i < currentMatches.length; i++) {
      const m = currentMatches[i];
      const pair1 = makePairKey(m.team1_player1_id, m.team1_player2_id);
      const pair2 = makePairKey(m.team2_player1_id, m.team2_player2_id);
      
      if (!partnerCounts[pair1]) partnerCounts[pair1] = [];
      if (!partnerCounts[pair2]) partnerCounts[pair2] = [];
      partnerCounts[pair1].push(i);
      partnerCounts[pair2].push(i);
    }
    
    // Find a repeated pair
    let foundFix = false;
    for (const [pair, indices] of Object.entries(partnerCounts)) {
      if (indices.length <= 1) continue;
      
      // Try to fix one of the matches with this repeated pair
      for (const matchIdx of indices.slice(1)) { // Skip first occurrence
        const m = currentMatches[matchIdx];
        const playersInMatch = [m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id];
        
        // Try all 3 possible team pairings
        const pairings = [
          [[0, 1], [2, 3]],
          [[0, 2], [1, 3]],
          [[0, 3], [1, 2]],
        ];
        
        let bestPairing: Match | null = null;
        let bestScore = Infinity;
        
        for (const [[a, b], [c, d]] of pairings) {
          const newMatch: Match = {
            team1_player1_id: playersInMatch[a],
            team1_player2_id: playersInMatch[b],
            team2_player1_id: playersInMatch[c],
            team2_player2_id: playersInMatch[d],
          };
          
          const newPair1 = makePairKey(newMatch.team1_player1_id, newMatch.team1_player2_id);
          const newPair2 = makePairKey(newMatch.team2_player1_id, newMatch.team2_player2_id);
          
          // Check if this pairing creates new repeats
          const testMatches = [...currentMatches];
          testMatches[matchIdx] = newMatch;
          const testValidation = validateConstraints(testMatches, players);
          
          // Also check back-to-back constraint
          if (testValidation.partnerRepeats < validation.partnerRepeats && 
              testValidation.backToBackCount <= validation.backToBackCount) {
            if (testValidation.partnerRepeats < bestScore) {
              bestScore = testValidation.partnerRepeats;
              bestPairing = newMatch;
            }
          }
        }
        
        if (bestPairing) {
          currentMatches[matchIdx] = bestPairing;
          foundFix = true;
          break;
        }
      }
      
      if (foundFix) break;
    }
    
    // If team pairing swap didn't work, try player swap between adjacent matches
    if (!foundFix) {
      foundFix = tryPlayerSwap(currentMatches, players, validation);
    }
    
    if (!foundFix) {
      // No more improvements possible
      break;
    }
    
    improved = true;
  }
  
  return { matches: currentMatches, improved };
}

// Try swapping a player between two nearby matches
function tryPlayerSwap(matches: Match[], players: Player[], currentValidation: ValidationResult): boolean {
  const makePairKey = (a: string, b: string) => [a, b].sort().join("-");
  
  for (let i = 0; i < matches.length; i++) {
    // Try swapping with matches within distance 3
    for (let j = Math.max(0, i - 3); j <= Math.min(matches.length - 1, i + 3); j++) {
      if (i === j) continue;
      
      const m1 = matches[i];
      const m2 = matches[j];
      
      const players1 = [m1.team1_player1_id, m1.team1_player2_id, m1.team2_player1_id, m1.team2_player2_id];
      const players2 = [m2.team1_player1_id, m2.team1_player2_id, m2.team2_player1_id, m2.team2_player2_id];
      
      // Try swapping each player from match i with each player from match j
      for (let pi = 0; pi < 4; pi++) {
        for (let pj = 0; pj < 4; pj++) {
          // Skip if same player (can't swap with self)
          if (players1[pi] === players2[pj]) continue;
          
          // Skip if player from j is already in match i
          if (players1.includes(players2[pj])) continue;
          
          // Skip if player from i is already in match j
          if (players2.includes(players1[pi])) continue;
          
          // Create swapped matches
          const newPlayers1 = [...players1];
          const newPlayers2 = [...players2];
          newPlayers1[pi] = players2[pj];
          newPlayers2[pj] = players1[pi];
          
          // Try all pairings for both matches
          const bestResult = findBestPairings(newPlayers1, newPlayers2, matches, i, j, players, currentValidation);
          
          if (bestResult) {
            matches[i] = bestResult.match1;
            matches[j] = bestResult.match2;
            return true;
          }
        }
      }
    }
  }
  
  return false;
}

function findBestPairings(
  players1: string[],
  players2: string[],
  matches: Match[],
  idx1: number,
  idx2: number,
  allPlayers: Player[],
  currentValidation: ValidationResult
): { match1: Match; match2: Match } | null {
  const pairings = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ];
  
  let best: { match1: Match; match2: Match } | null = null;
  let bestScore = currentValidation.partnerRepeats;
  
  for (const [[a1, b1], [c1, d1]] of pairings) {
    const match1: Match = {
      team1_player1_id: players1[a1],
      team1_player2_id: players1[b1],
      team2_player1_id: players1[c1],
      team2_player2_id: players1[d1],
    };
    
    for (const [[a2, b2], [c2, d2]] of pairings) {
      const match2: Match = {
        team1_player1_id: players2[a2],
        team1_player2_id: players2[b2],
        team2_player1_id: players2[c2],
        team2_player2_id: players2[d2],
      };
      
      // Test this combination
      const testMatches = [...matches];
      testMatches[idx1] = match1;
      testMatches[idx2] = match2;
      
      const testValidation = validateConstraints(testMatches, allPlayers);
      
      // Check if this is an improvement without breaking other constraints
      if (testValidation.partnerRepeats < bestScore &&
          testValidation.backToBackCount <= currentValidation.backToBackCount + 1 &&
          testValidation.maxSitout <= 2) {
        bestScore = testValidation.partnerRepeats;
        best = { match1, match2 };
      }
    }
  }
  
  return best;
}

// Heuristic-based generation for N=8,12 (fallback)
function generateHeuristic(players: Player[], n: number, seed: number): GenerationResult {
  const MATCH_COUNT = 17;
  const totalSlots = MATCH_COUNT * 4;
  const targetBase = Math.floor(totalSlots / n);
  const remainder = totalSlots % n;
  
  const playerTargets: Record<string, number> = {};
  const shuffledPlayers = seededShuffle([...players], seed);
  shuffledPlayers.forEach((p, i) => {
    playerTargets[p.id] = i < remainder ? targetBase + 1 : targetBase;
  });
  
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
  
  const maxSitout = 2;
  
  for (let matchIndex = 0; matchIndex < MATCH_COUNT; matchIndex++) {
    players.forEach(p => {
      if (lastPlayedMatch[p.id] === matchIndex - 1) {
        sitoutStreak[p.id] = 0;
      } else if (matchIndex > 0) {
        sitoutStreak[p.id]++;
      }
    });
    
    const eligible: Player[] = [];
    const mustPlay: Player[] = [];
    
    for (const p of players) {
      const playedLast = lastPlayedMatch[p.id] === matchIndex - 1;
      const atTarget = matchesPlayed[p.id] >= playerTargets[p.id];
      const criticalSitout = sitoutStreak[p.id] >= maxSitout;
      
      if (criticalSitout && !atTarget) {
        mustPlay.push(p);
        eligible.push(p);
        continue;
      }
      
      if (atTarget) continue;
      if (playedLast) continue;
      
      eligible.push(p);
    }
    
    // Score and select players
    const scored = eligible.map(p => {
      let score = 0;
      if (mustPlay.some(mp => mp.id === p.id)) score += 1000;
      score += sitoutStreak[p.id] * 100;
      score += (playerTargets[p.id] - matchesPlayed[p.id]) * 50;
      if (lastPlayedMatch[p.id] === matchIndex - 1) score -= 20;
      return { player: p, score };
    });
    
    scored.sort((a, b) => b.score - a.score);
    
    const selected: Player[] = [...mustPlay];
    const mustPlayIds = new Set(mustPlay.map(p => p.id));
    
    for (const { player } of scored) {
      if (selected.length >= 4) break;
      if (!mustPlayIds.has(player.id)) {
        selected.push(player);
      }
    }
    
    // Fallback if not enough players
    while (selected.length < 4) {
      const remaining = players.filter(p => !selected.some(s => s.id === p.id));
      if (remaining.length > 0) {
        selected.push(remaining[0]);
      } else break;
    }
    
    if (selected.length < 4) {
      // Emergency fallback
      const emergency = players.slice(0, 4);
      matches.push({
        team1_player1_id: emergency[0].id,
        team1_player2_id: emergency[1].id,
        team2_player1_id: emergency[2].id,
        team2_player2_id: emergency[3].id,
      });
      continue;
    }
    
    // Form teams avoiding partner repeats
    const ids = selected.map(p => p.id);
    const pairings = [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
      [[0, 3], [1, 2]],
    ];
    
    let bestPairing: { team1: [string, string]; team2: [string, string] } | null = null;
    let bestScore = Infinity;
    
    for (const [[a, b], [c, d]] of pairings) {
      const team1: [string, string] = [ids[a], ids[b]];
      const team2: [string, string] = [ids[c], ids[d]];
      
      const pair1Used = partnerPairs.has(makePairKey(team1[0], team1[1]));
      const pair2Used = partnerPairs.has(makePairKey(team2[0], team2[1]));
      
      let oppScore = 0;
      for (const p1 of team1) {
        for (const p2 of team2) {
          oppScore += opponentCounts[makePairKey(p1, p2)] || 0;
        }
      }
      
      // Heavily penalize partner repeats
      if (pair1Used) oppScore += 1000;
      if (pair2Used) oppScore += 1000;
      
      if (oppScore < bestScore) {
        bestScore = oppScore;
        bestPairing = { team1, team2 };
      }
    }
    
    if (bestPairing) {
      matches.push({
        team1_player1_id: bestPairing.team1[0],
        team1_player2_id: bestPairing.team1[1],
        team2_player1_id: bestPairing.team2[0],
        team2_player2_id: bestPairing.team2[1],
      });
      
      for (const pid of selected.map(p => p.id)) {
        matchesPlayed[pid]++;
        lastPlayedMatch[pid] = matchIndex;
        sitoutStreak[pid] = 0;
      }
      
      partnerPairs.add(makePairKey(bestPairing.team1[0], bestPairing.team1[1]));
      partnerPairs.add(makePairKey(bestPairing.team2[0], bestPairing.team2[1]));
      
      for (const p1 of bestPairing.team1) {
        for (const p2 of bestPairing.team2) {
          const key = makePairKey(p1, p2);
          opponentCounts[key] = (opponentCounts[key] || 0) + 1;
        }
      }
    }
  }
  
  const validation = validateConstraints(matches, players);
  
  const diagnostics: Diagnostics = {
    player_count: n,
    matches_per_court: MATCH_COUNT,
    min_matches_per_player: validation.minMatches,
    max_matches_per_player: validation.maxMatches,
    max_sitout_streak: validation.maxSitout,
    repeat_partner_count: validation.partnerRepeats,
    back_to_back_count: validation.backToBackCount,
    used_seed: seed,
    generation_mode: validation.partnerRepeats === 0 ? "heuristic" : "heuristic_fallback",
  };
  
  return { ok: true, generation_mode: diagnostics.generation_mode, diagnostics, matches };
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

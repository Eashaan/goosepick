import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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
  court_number: number;
  global_match_index: number;
}

interface Diagnostics {
  player_count: number;
  court_count: number;
  total_matches: number;
  min_matches_per_player: number;
  max_matches_per_player: number;
  max_sitout_streak: number;
  repeat_partner_count: number;
  repeat_opponent_count: number;
  back_to_back_batch_violations: number;
  used_seed: number;
  generation_mode: string;
  note?: string;
}

function errorResponse(stage: string, message: string, details?: string, code?: string) {
  return new Response(
    JSON.stringify({ ok: false, stage, message, details: details || "", code: code || "" }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ── Helpers ────────────────────────────────────────────
function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  const rng = seededRng(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

// ── Core generation ────────────────────────────────────
function generateGroupRotation(
  players: Player[],
  courtNumbers: number[],
  totalMatches: number,
  seed: number,
): { ok: boolean; generation_mode: string; diagnostics: Diagnostics; matches: Match[] } {
  const N = courtNumbers.length;
  const P = players.length;
  const rng = seededRng(seed);

  const totalBatches = Math.ceil(totalMatches / N);

  const totalSlots = totalMatches * 4;
  const targetBase = Math.floor(totalSlots / P);
  const remainder = totalSlots % P;

  const playerTargets: Record<string, number> = {};
  const shuffled = seededShuffle(players, seed);
  shuffled.forEach((p, i) => {
    playerTargets[p.id] = i < remainder ? targetBase + 1 : targetBase;
  });

  const matchesPlayed: Record<string, number> = {};
  const consecutivePlays: Record<string, number> = {};
  const lastPlayedBatch: Record<string, number> = {};
  const partnerPairs: Record<string, number> = {};
  const opponentPairs: Record<string, number> = {};

  players.forEach((p) => {
    matchesPlayed[p.id] = 0;
    consecutivePlays[p.id] = 0;
    lastPlayedBatch[p.id] = -999;
  });

  const matches: Match[] = [];
  let generationMode = "group_heuristic";
  let note: string | undefined;

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const matchesInBatch = Math.min(N, totalMatches - batchIdx * N);

    players.forEach((p) => {
      if (lastPlayedBatch[p.id] === batchIdx - 1) {
        consecutivePlays[p.id]++;
      } else {
        consecutivePlays[p.id] = 0;
      }
    });

    const slotsNeeded = matchesInBatch * 4;

    const scored = players
      .filter((p) => matchesPlayed[p.id] < playerTargets[p.id])
      .map((p) => {
        let score = 0;
        const batchesSinceLast = batchIdx - (lastPlayedBatch[p.id] ?? -999);
        score += batchesSinceLast * 100;
        score += (playerTargets[p.id] - matchesPlayed[p.id]) * 50;
        if (consecutivePlays[p.id] >= 2) score -= 200;
        score += rng() * 10;
        return { player: p, score };
      })
      .sort((a, b) => b.score - a.score);

    const selected: Player[] = [];
    const selectedIds = new Set<string>();

    for (const p of players) {
      if (selectedIds.size >= slotsNeeded) break;
      const batchesSinceLast = batchIdx - (lastPlayedBatch[p.id] ?? -999);
      if (batchesSinceLast >= 3 && matchesPlayed[p.id] < playerTargets[p.id]) {
        selected.push(p);
        selectedIds.add(p.id);
      }
    }

    for (const { player } of scored) {
      if (selectedIds.size >= slotsNeeded) break;
      if (!selectedIds.has(player.id)) {
        selected.push(player);
        selectedIds.add(player.id);
      }
    }

    if (selected.length < slotsNeeded) {
      for (const p of players) {
        if (selectedIds.size >= slotsNeeded) break;
        if (!selectedIds.has(p.id)) {
          selected.push(p);
          selectedIds.add(p.id);
        }
      }
    }

    const batchPlayers = seededShuffle(selected.slice(0, slotsNeeded), seed + batchIdx * 7919);

    for (let m = 0; m < matchesInBatch; m++) {
      const globalIdx = batchIdx * N + m;
      if (globalIdx >= totalMatches) break;

      const fourPlayers = batchPlayers.slice(m * 4, m * 4 + 4);
      if (fourPlayers.length < 4) {
        const emergency = seededShuffle([...players], seed + globalIdx).slice(0, 4);
        matches.push({
          team1_player1_id: emergency[0].id,
          team1_player2_id: emergency[1].id,
          team2_player1_id: emergency[2].id,
          team2_player2_id: emergency[3].id,
          court_number: courtNumbers[m % N],
          global_match_index: globalIdx + 1,
        });
        continue;
      }

      const ids = fourPlayers.map((p) => p.id);
      const pairings: [number, number, number, number][] = [
        [0, 1, 2, 3],
        [0, 2, 1, 3],
        [0, 3, 1, 2],
      ];

      let bestMatch: Match | null = null;
      let bestScore = Infinity;

      for (const [a, b, c, d] of pairings) {
        const pk1 = pairKey(ids[a], ids[b]);
        const pk2 = pairKey(ids[c], ids[d]);
        let score = 0;
        score += (partnerPairs[pk1] || 0) * 1000;
        score += (partnerPairs[pk2] || 0) * 1000;
        for (const t1 of [ids[a], ids[b]]) {
          for (const t2 of [ids[c], ids[d]]) {
            score += (opponentPairs[pairKey(t1, t2)] || 0) * 10;
          }
        }

        if (score < bestScore) {
          bestScore = score;
          bestMatch = {
            team1_player1_id: ids[a],
            team1_player2_id: ids[b],
            team2_player1_id: ids[c],
            team2_player2_id: ids[d],
            court_number: courtNumbers[m % N],
            global_match_index: globalIdx + 1,
          };
        }
      }

      if (bestMatch) {
        matches.push(bestMatch);

        const pk1 = pairKey(bestMatch.team1_player1_id, bestMatch.team1_player2_id);
        const pk2 = pairKey(bestMatch.team2_player1_id, bestMatch.team2_player2_id);
        partnerPairs[pk1] = (partnerPairs[pk1] || 0) + 1;
        partnerPairs[pk2] = (partnerPairs[pk2] || 0) + 1;

        for (const t1 of [bestMatch.team1_player1_id, bestMatch.team1_player2_id]) {
          for (const t2 of [bestMatch.team2_player1_id, bestMatch.team2_player2_id]) {
            const ok = pairKey(t1, t2);
            opponentPairs[ok] = (opponentPairs[ok] || 0) + 1;
          }
        }

        for (const pid of ids) {
          matchesPlayed[pid]++;
          lastPlayedBatch[pid] = batchIdx;
        }
      }
    }
  }

  // ── Validate ─────────────────────────────────────────
  const counts = Object.values(matchesPlayed);
  const minMatches = Math.min(...counts);
  const maxMatches = Math.max(...counts);

  let maxSitout = 0;
  for (const p of players) {
    let streak = 0;
    let maxStreak = 0;
    for (let b = 0; b < totalBatches; b++) {
      const inBatch = matches.some(
        (m) =>
          Math.ceil(m.global_match_index / N) === b + 1 &&
          (m.team1_player1_id === p.id ||
            m.team1_player2_id === p.id ||
            m.team2_player1_id === p.id ||
            m.team2_player2_id === p.id),
      );
      if (!inBatch) {
        streak++;
        maxStreak = Math.max(maxStreak, streak);
      } else {
        streak = 0;
      }
    }
    maxSitout = Math.max(maxSitout, maxStreak);
  }

  let repeatPartnerCount = 0;
  for (const c of Object.values(partnerPairs)) {
    if (c > 1) repeatPartnerCount += c - 1;
  }

  let repeatOpponentCount = 0;
  for (const c of Object.values(opponentPairs)) {
    if (c > 1) repeatOpponentCount += c - 1;
  }

  let batchViolations = 0;
  for (let b = 0; b < totalBatches; b++) {
    const batchMatches = matches.filter(
      (m) => Math.ceil(m.global_match_index / N) === b + 1,
    );
    const seen = new Set<string>();
    for (const m of batchMatches) {
      for (const pid of [
        m.team1_player1_id,
        m.team1_player2_id,
        m.team2_player1_id,
        m.team2_player2_id,
      ]) {
        if (seen.has(pid)) batchViolations++;
        seen.add(pid);
      }
    }
  }

  if (repeatPartnerCount > 0) {
    generationMode = "group_fallback";
    note = `Generated with ${repeatPartnerCount} partner repeat(s) due to player/match constraints.`;
  }

  if (maxMatches - minMatches > 1) {
    generationMode = "group_fallback";
    note = (note || "") + ` Match balance diff: ${maxMatches - minMatches}.`;
  }

  const diagnostics: Diagnostics = {
    player_count: P,
    court_count: N,
    total_matches: totalMatches,
    min_matches_per_player: minMatches,
    max_matches_per_player: maxMatches,
    max_sitout_streak: maxSitout,
    repeat_partner_count: repeatPartnerCount,
    repeat_opponent_count: repeatOpponentCount,
    back_to_back_batch_violations: batchViolations,
    used_seed: seed,
    generation_mode: generationMode,
    note,
  };

  return { ok: true, generation_mode: generationMode, diagnostics, matches };
}

// ── Edge function ──────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("auth", "Unauthorized");
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
      return errorResponse("auth", "Invalid authentication", claimsError?.message);
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
      return errorResponse("auth", "Insufficient permissions");
    }

    const { groupId, sessionId } = await req.json();

    if (!groupId) {
      return errorResponse("validation", "Group ID is required");
    }

    // Fetch group config
    const { data: group, error: groupError } = await supabase
      .from("court_groups")
      .select("*")
      .eq("id", groupId)
      .maybeSingle();

    if (groupError || !group) {
      return errorResponse("precheck", "Group not found", groupError?.message, groupError?.code);
    }

    let courtNumbers: number[] = group.court_ids || [];

    if (courtNumbers.length === 0) {
      const { data: courtUnit } = await supabase
        .from("court_units")
        .select("group_court_numbers")
        .eq("court_group_id", groupId)
        .maybeSingle();

      if (courtUnit?.group_court_numbers) {
        courtNumbers = courtUnit.group_court_numbers;
      }
    }

    const N = courtNumbers.length;

    if (N < 1) {
      return errorResponse("precheck", "Group has no courts assigned");
    }

    const effectiveSessionId = sessionId || group.session_id || null;

    const durationHours: number = group.duration_hours || 2;
    const matchesPerHour: number = group.matches_per_hour || 6;
    const totalMatches: number =
      group.total_matches || Math.round(durationHours * matchesPerHour * N);

    // ── Precheck: existing matches for this group+session ──
    let existingQuery = supabase
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("group_id", groupId);
    if (effectiveSessionId) {
      existingQuery = existingQuery.eq("session_id", effectiveSessionId);
    }
    const { count: existingCount } = await existingQuery;

    if (existingCount && existingCount > 0) {
      return errorResponse(
        "precheck",
        "Rotation already exists for this group. Please Reset Group to regenerate.",
      );
    }

    // Fetch players scoped to this group + session
    let playerQuery = supabase
      .from("players")
      .select("id, name")
      .eq("group_id", groupId)
      .order("created_at", { ascending: true });

    if (effectiveSessionId) {
      playerQuery = playerQuery.eq("session_id", effectiveSessionId);
    }

    const { data: players, error: playersError } = await playerQuery;

    if (playersError) {
      return errorResponse("players", "Failed to fetch players", playersError.message, playersError.code);
    }

    const P = players?.length || 0;

    if (P === 0) {
      return errorResponse("players", "No players found for this group and session. Add players first.");
    }

    // Validate player IDs
    const missingIds = (players || []).filter((p) => !p.id);
    if (missingIds.length > 0) {
      return errorResponse("players", "Some players are missing IDs. Please resave players and try again.");
    }

    const minPlayers = 4 * N;
    const maxPlayers = 8 * N;

    if (P < minPlayers || P > maxPlayers) {
      return errorResponse(
        "validation",
        `Invalid player count: ${P}. For ${N} courts, need ${minPlayers}-${maxPlayers} players.`,
      );
    }

    // ── Ensure group_physical_courts exist ──────────────────
    // For each court_number, we need a unique courts.id
    const courtIdMap: Record<number, number> = {};

    for (const cn of courtNumbers) {
      // Check if mapping already exists
      const { data: existing } = await supabase
        .from("group_physical_courts")
        .select("court_id")
        .eq("group_id", groupId)
        .eq("court_number", cn)
        .eq("session_id", effectiveSessionId)
        .maybeSingle();

      if (existing?.court_id) {
        courtIdMap[cn] = existing.court_id;
      } else {
        // Create a new courts row for this group physical court
        const { data: newCourt, error: courtErr } = await supabase
          .from("courts")
          .insert({
            name: `Group Court ${cn}`,
            session_id: effectiveSessionId,
          })
          .select("id")
          .single();

        if (courtErr || !newCourt) {
          return errorResponse("precheck", `Failed to create court entry for court ${cn}`, courtErr?.message);
        }

        // Create mapping row
        const { error: mapErr } = await supabase
          .from("group_physical_courts")
          .insert({
            group_id: groupId,
            court_number: cn,
            court_id: newCourt.id,
            session_id: effectiveSessionId,
          });

        if (mapErr) {
          return errorResponse("precheck", `Failed to create court mapping for court ${cn}`, mapErr.message);
        }

        courtIdMap[cn] = newCourt.id;
      }
    }

    // Generate rotation with retry
    let bestResult: ReturnType<typeof generateGroupRotation> | null = null;
    const MAX_ATTEMPTS = 50;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const seed = Date.now() + attempt * 31337;
      const result = generateGroupRotation(players, courtNumbers, totalMatches, seed);

      if (!bestResult) {
        bestResult = result;
      } else if (
        result.diagnostics.repeat_partner_count <
          bestResult.diagnostics.repeat_partner_count ||
        (result.diagnostics.repeat_partner_count ===
          bestResult.diagnostics.repeat_partner_count &&
          result.diagnostics.back_to_back_batch_violations <
            bestResult.diagnostics.back_to_back_batch_violations)
      ) {
        bestResult = result;
      }

      if (
        result.diagnostics.repeat_partner_count === 0 &&
        result.diagnostics.back_to_back_batch_violations === 0 &&
        result.diagnostics.max_sitout_streak <= 2
      ) {
        bestResult = result;
        break;
      }
    }

    const result = bestResult!;
    console.log(
      "Group rotation result:",
      JSON.stringify({
        mode: result.generation_mode,
        diagnostics: result.diagnostics,
      }),
    );

    // Build match inserts — court_id from group_physical_courts, match_index is local per-court
    const perCourtCounter: Record<number, number> = {};
    const matchInserts = result.matches.map((m) => {
      const physicalCourtId = courtIdMap[m.court_number];
      // Compute local per-court match_index (0-based for legacy compat)
      if (perCourtCounter[m.court_number] === undefined) {
        perCourtCounter[m.court_number] = 0;
      }
      const localIndex = perCourtCounter[m.court_number];
      perCourtCounter[m.court_number]++;

      return {
        group_id: groupId,
        court_number: m.court_number,
        global_match_index: m.global_match_index,
        match_index: localIndex,
        court_id: physicalCourtId,
        team1_player1_id: m.team1_player1_id,
        team1_player2_id: m.team1_player2_id,
        team2_player1_id: m.team2_player1_id,
        team2_player2_id: m.team2_player2_id,
        status: "pending",
        override_played: false,
        session_id: effectiveSessionId,
      };
    });

    // Single bulk insert — atomic
    const { error: insertError } = await supabase
      .from("matches")
      .insert(matchInserts);

    if (insertError) {
      console.error("Insert error:", JSON.stringify(insertError));
      return errorResponse(
        "insert_matches",
        `Failed to save rotation: ${insertError.message}`,
        JSON.stringify(insertError),
        insertError.code,
      );
    }

    // Delete existing group_court_state (cleanup before reinit)
    await supabase.from("group_court_state").delete().eq("group_id", groupId);

    // Initialize group_court_state for each court
    const stateInserts = courtNumbers.map((cn) => ({
      session_id: effectiveSessionId,
      group_id: groupId,
      court_number: cn,
      current_match_global_index: null,
      current_match_id: null,
      is_live: false,
    }));

    const { error: stateError } = await supabase.from("group_court_state").insert(stateInserts);
    if (stateError) {
      console.error("State insert error:", JSON.stringify(stateError));
      // Non-fatal, rotation was saved
    }

    // Update group with total_matches and lock
    await supabase
      .from("court_groups")
      .update({
        total_matches: totalMatches,
        is_locked: true,
        locked_at: new Date().toISOString(),
      })
      .eq("id", groupId);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    console.error("Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return errorResponse("unexpected", errorMessage, String(error));
  }
});

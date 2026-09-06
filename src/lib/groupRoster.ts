import type { Database } from "@/integrations/supabase/types";

type CourtState = Database["public"]["Tables"]["court_state"]["Row"];

/**
 * Shared group-roster helpers. PublicGroup and the participant experience page
 * both feed the same PersonalRoster/GroupCourtPulse components, so the
 * synthetic court-state and label logic lives here instead of being copied.
 */

/** "Court 1" / "Courts 1 & 2" / "Courts 1, 2 & 3" from display court numbers. */
export function formatCourtNumbersLabel(
  nums: readonly number[] | null | undefined,
  fallback = "Group",
): string {
  if (!nums || nums.length === 0) return fallback;
  if (nums.length === 1) return `Court ${nums[0]}`;
  if (nums.length === 2) return `Courts ${nums[0]} & ${nums[1]}`;
  const last = nums[nums.length - 1];
  const rest = nums.slice(0, -1);
  return `Courts ${rest.join(", ")} & ${last}`;
}

export interface SyntheticGroupStateInput {
  courtStates: ReadonlyArray<{ is_live: boolean; current_match_global_index: number | null }>;
  matches: ReadonlyArray<{ status: string }>;
  groupId: string | null | undefined;
  /** Sentinel court id PersonalRoster uses for storage keys / feedback. */
  syntheticCourtId: number;
  sessionId: string | null | undefined;
  courtsInGroup: number;
}

/**
 * PersonalRoster expects a single court_state. In group mode several physical
 * courts play in parallel, so we synthesise one from the group court states:
 * the current "round" is derived from the live global match index divided by
 * the number of courts in the group.
 */
export function buildSyntheticGroupCourtState({
  courtStates,
  matches,
  groupId,
  syntheticCourtId,
  sessionId,
  courtsInGroup,
}: SyntheticGroupStateInput): CourtState | undefined {
  if (courtStates.length === 0) return undefined;
  const liveState = courtStates.find((cs) => cs.is_live);
  const currentGlobalIndex = liveState?.current_match_global_index ?? 0;
  const anyLive = courtStates.some((cs) => cs.is_live);
  const allMatchesDone = matches.length > 0 && matches.every((m) => m.status === "completed");

  const N = courtsInGroup || 1;
  const currentRound = currentGlobalIndex > 0 ? Math.floor((currentGlobalIndex - 1) / N) : 0;

  return {
    id: `synthetic-${groupId ?? "group"}`,
    court_id: syntheticCourtId,
    current_match_index: currentRound,
    phase: allMatchesDone ? ("completed" as const) : anyLive ? ("in_progress" as const) : ("idle" as const),
    session_id: sessionId ?? null,
    updated_at: new Date().toISOString(),
  };
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatCourtNumbersLabel } from "@/lib/groupRoster";
import {
  ASSIGNABLE_REGISTRATION_STATUSES,
  type RegistrationPoolRow,
} from "@/lib/registrationAssignment";

export const REGISTRATION_POOL_QUERY_KEY = "registration_pool";
export const TERMINAL_ROSTER_ATTENTION_QUERY_KEY = "terminal_roster_attention";

export interface AssignedPlayerInfo {
  playerId: string;
  name: string;
  courtId: number | null;
  groupId: string | null;
  /** "Court 3" / "Courts 1 & 2" — where the registration already plays. */
  unitLabel: string;
}

export interface RegistrationPoolData {
  /** Every assignable registration for the session (paid / profile_required / confirmed). */
  registrations: RegistrationPoolRow[];
  /** registration id → linked player (already on a roster). */
  assigned: Map<string, AssignedPlayerInfo>;
  /** Registrations with no players.registration_id link yet. */
  waiting: RegistrationPoolRow[];
}

const POOL_SELECT = `id, session_id, seat_index, status, participant_name, participant_email, profile_id, purchaser_profile_id, created_at,
  shopify_product_id, shopify_variant_id, line_item_title, line_item_quantity, selected_skill_level,
  profile:participant_profiles!experience_registrations_profile_id_fkey ( first_name, last_name, email ),
  purchaser:participant_profiles!experience_registrations_purchaser_profile_id_fkey ( first_name, last_name, email ),
  commerce_order:commerce_orders ( shopify_order_name, purchaser_email ),
  mapping:shopify_session_mappings ( metadata )`;

/** A court/group label for a roster player, using the session's own units. */
async function buildUnitLabels(sessionId: string) {
  const [{ data: courts }, { data: groupUnits }] = await Promise.all([
    supabase.from("courts").select("id, name").eq("session_id", sessionId),
    supabase
      .from("court_units")
      .select("court_group_id, group_court_numbers, display_name")
      .eq("session_id", sessionId)
      .eq("type", "group"),
  ]);

  const courtNames = new Map<number, string>((courts ?? []).map((c) => [c.id, c.name]));
  const groupLabels = new Map<string, string>();
  (groupUnits ?? []).forEach((u) => {
    if (u.court_group_id) {
      groupLabels.set(
        u.court_group_id,
        u.group_court_numbers?.length ? formatCourtNumbersLabel(u.group_court_numbers) : u.display_name,
      );
    }
  });

  return (courtId: number | null, groupId: string | null): string =>
    groupId
      ? groupLabels.get(groupId) ?? "Group"
      : courtId != null
        ? courtNames.get(courtId) ?? `Court ${courtId}`
        : "Roster";
}

/**
 * Admin-only view of the registrations for ONE session and which of them are
 * already linked to a roster player. Reads only; assignment goes through
 * assignRegistrationToRoster().
 */
export function useRegistrationPool(sessionId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: [REGISTRATION_POOL_QUERY_KEY, sessionId],
    enabled: Boolean(sessionId) && enabled,
    refetchInterval: 15_000,
    queryFn: async (): Promise<RegistrationPoolData> => {
      const { data: rows, error } = await supabase
        .from("experience_registrations")
        .select(POOL_SELECT)
        .eq("session_id", sessionId!)
        .in("status", [...ASSIGNABLE_REGISTRATION_STATUSES])
        .order("created_at", { ascending: true })
        .order("seat_index", { ascending: true });
      if (error) throw error;

      const registrations = (rows ?? []) as unknown as RegistrationPoolRow[];
      const assigned = new Map<string, AssignedPlayerInfo>();
      if (registrations.length === 0) {
        return { registrations, assigned, waiting: [] };
      }

      const [{ data: linkedPlayers }, labelFor] = await Promise.all([
        supabase
          .from("players")
          .select("id, name, court_id, group_id, registration_id")
          .eq("session_id", sessionId!)
          .not("registration_id", "is", null),
        buildUnitLabels(sessionId!),
      ]);

      (linkedPlayers ?? []).forEach((p) => {
        if (!p.registration_id) return;
        assigned.set(p.registration_id, {
          playerId: p.id,
          name: p.name,
          courtId: p.court_id,
          groupId: p.group_id,
          unitLabel: labelFor(p.court_id, p.group_id),
        });
      });

      return {
        registrations,
        assigned,
        waiting: registrations.filter((r) => !assigned.has(r.id)),
      };
    },
  });
}

export interface TerminalRosterAttentionRow {
  registrationId: string;
  status: "cancelled" | "refunded";
  seatIndex: number;
  playerId: string;
  playerName: string;
  unitLabel: string;
}

/**
 * Cancelled / refunded registrations for this session that STILL have a roster
 * player. Read-only on purpose: nothing is removed, rebalanced, reset or
 * regenerated — a human decides what to do with the seat.
 */
export function useTerminalRosterAttention(sessionId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: [TERMINAL_ROSTER_ATTENTION_QUERY_KEY, sessionId],
    enabled: Boolean(sessionId) && enabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<TerminalRosterAttentionRow[]> => {
      const { data: terminal, error } = await supabase
        .from("experience_registrations")
        .select("id, status, seat_index")
        .eq("session_id", sessionId!)
        .in("status", ["cancelled", "refunded"]);
      if (error) throw error;
      if (!terminal || terminal.length === 0) return [];

      const ids = terminal.map((r) => r.id);
      const { data: players, error: playersError } = await supabase
        .from("players")
        .select("id, name, court_id, group_id, registration_id")
        .eq("session_id", sessionId!)
        .in("registration_id", ids);
      if (playersError) throw playersError;
      if (!players || players.length === 0) return [];

      const labelFor = await buildUnitLabels(sessionId!);
      const statusById = new Map(terminal.map((r) => [r.id, r]));

      return players.flatMap((player) => {
        const reg = player.registration_id ? statusById.get(player.registration_id) : undefined;
        if (!reg) return [];
        return [
          {
            registrationId: reg.id,
            status: reg.status as "cancelled" | "refunded",
            seatIndex: reg.seat_index,
            playerId: player.id,
            playerName: player.name,
            unitLabel: labelFor(player.court_id, player.group_id),
          },
        ];
      });
    },
  });
}

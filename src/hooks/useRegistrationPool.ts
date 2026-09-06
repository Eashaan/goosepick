import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatCourtNumbersLabel } from "@/lib/groupRoster";
import {
  ASSIGNABLE_REGISTRATION_STATUSES,
  type RegistrationPoolRow,
} from "@/lib/registrationAssignment";

export const REGISTRATION_POOL_QUERY_KEY = "registration_pool";

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
  profile:participant_profiles!experience_registrations_profile_id_fkey ( first_name, last_name, email ),
  purchaser:participant_profiles!experience_registrations_purchaser_profile_id_fkey ( first_name, last_name, email ),
  commerce_order:commerce_orders ( shopify_order_name, purchaser_email )`;

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

      const [{ data: linkedPlayers }, { data: courts }, { data: groupUnits }] = await Promise.all([
        supabase
          .from("players")
          .select("id, name, court_id, group_id, registration_id")
          .eq("session_id", sessionId!)
          .not("registration_id", "is", null),
        supabase.from("courts").select("id, name").eq("session_id", sessionId!),
        supabase
          .from("court_units")
          .select("court_group_id, group_court_numbers, display_name")
          .eq("session_id", sessionId!)
          .eq("type", "group"),
      ]);

      const courtNames = new Map<number, string>((courts ?? []).map((c) => [c.id, c.name]));
      const groupLabels = new Map<string, string>();
      (groupUnits ?? []).forEach((u) => {
        if (u.court_group_id) {
          groupLabels.set(
            u.court_group_id,
            u.group_court_numbers?.length
              ? formatCourtNumbersLabel(u.group_court_numbers)
              : u.display_name,
          );
        }
      });

      (linkedPlayers ?? []).forEach((p) => {
        if (!p.registration_id) return;
        const unitLabel = p.group_id
          ? groupLabels.get(p.group_id) ?? "Group"
          : p.court_id != null
            ? courtNames.get(p.court_id) ?? `Court ${p.court_id}`
            : "Roster";
        assigned.set(p.registration_id, {
          playerId: p.id,
          name: p.name,
          courtId: p.court_id,
          groupId: p.group_id,
          unitLabel,
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

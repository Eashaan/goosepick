import { supabase } from "@/integrations/supabase/client";

/**
 * Untyped accessor for the Phase 1 participant/registration tables.
 *
 * The generated `types.ts` file is platform-managed and only regenerates after
 * the additive migration is applied. Until then, the new tables are queried
 * through this deliberately loose accessor so no existing typed call sites are
 * affected. Row shapes are described by the interfaces below.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const participantDb = supabase as any;

export interface ParticipantProfile {
  id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  preferred_city_id: string | null;
  marketing_opt_in: boolean;
  created_at: string;
  updated_at: string;
}

export type RegistrationStatus =
  | "paid"
  | "profile_required"
  | "confirmed"
  | "cancelled"
  | "refunded"
  | "unmapped";

export interface ExperienceRegistrationRow {
  id: string;
  session_id: string | null;
  profile_id: string | null;
  purchaser_profile_id: string | null;
  seat_index: number;
  participant_name: string | null;
  status: RegistrationStatus;
  created_at: string;
  sessions?: {
    id: string;
    date: string;
    status: "draft" | "live" | "ended";
    event_type: "social" | "thursdays";
    session_label: string | null;
    cities?: { name: string } | null;
    locations?: { name: string } | null;
  } | null;
}

/** Display state derived from stored status + session state. Never persisted. */
export type DerivedRegistrationState =
  | "profile_required"
  | "roster_pending"
  | "roster_ready"
  | "live"
  | "completed"
  | "cancelled"
  | "refunded"
  | "unmapped";

export function deriveRegistrationState(
  registration: ExperienceRegistrationRow,
  hasRosterPlayer: boolean,
): DerivedRegistrationState {
  if (registration.status === "cancelled") return "cancelled";
  if (registration.status === "refunded") return "refunded";
  if (registration.status === "unmapped") return "unmapped";
  if (registration.status === "profile_required" || !registration.profile_id) {
    return "profile_required";
  }

  const sessionStatus = registration.sessions?.status;
  if (sessionStatus === "ended") return "completed";
  if (sessionStatus === "live") return "live";
  return hasRosterPlayer ? "roster_ready" : "roster_pending";
}

export const REGISTRATION_STATE_LABEL: Record<DerivedRegistrationState, string> = {
  profile_required: "Complete your details",
  roster_pending: "Roster coming soon",
  roster_ready: "Roster ready",
  live: "Happening now",
  completed: "Completed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  unmapped: "Being confirmed",
};

import { supabase } from "@/integrations/supabase/client";

/**
 * Accessor + row shapes for the participant/registration tables.
 *
 * The Phase 1 schema is live and the generated `types.ts` now includes
 * `participant_profiles`, `commerce_orders`, `shopify_session_mappings` and
 * `experience_registrations`, so this is simply the fully typed client. The
 * interfaces below describe the projections the participant UI reads.
 */
export const participantDb = supabase;

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

export interface RegistrationSessionSummary {
  id: string;
  date: string;
  status: "draft" | "live" | "ended";
  event_type: "social" | "thursdays";
  session_label: string | null;
  cities?: { name: string } | null;
  locations?: { name: string } | null;
}

export interface ExperienceRegistrationRow {
  id: string;
  session_id: string | null;
  profile_id: string | null;
  purchaser_profile_id: string | null;
  seat_index: number;
  participant_name: string | null;
  status: RegistrationStatus;
  created_at: string;
  sessions?: RegistrationSessionSummary | null;
}

/** Shared select for a registration + its session summary (participant-facing). */
export const REGISTRATION_WITH_SESSION_SELECT =
  "id, session_id, profile_id, purchaser_profile_id, seat_index, participant_name, status, created_at, sessions:sessions ( id, date, status, event_type, session_label, cities ( name ), locations ( name ) )";

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

/** States that have something to open on /my/experience/:id. */
export function isRegistrationOpenable(state: DerivedRegistrationState): boolean {
  return state !== "cancelled" && state !== "refunded";
}

export function formatSessionTitle(session?: RegistrationSessionSummary | null): string {
  return (
    session?.session_label ||
    (session?.event_type === "thursdays" ? "Goosepick Thursdays" : "Goosepick Social")
  );
}

export function formatSessionPlace(session?: RegistrationSessionSummary | null): string {
  return [session?.locations?.name, session?.cities?.name].filter(Boolean).join(", ");
}

export function formatSessionDate(value?: string | null): string {
  if (!value) return "Date to be confirmed";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

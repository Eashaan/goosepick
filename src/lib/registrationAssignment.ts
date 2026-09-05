import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { RegistrationStatus } from "@/integrations/supabase/participantDb";

/**
 * Registration → roster assignment.
 *
 * A registration is turned into a normal `players` row (same table, same
 * columns the admin roster already uses) with `profile_id` + `registration_id`
 * set. There is no second roster engine: rotation, scoring, swaps and resets
 * keep operating on `players` exactly as before.
 *
 * Duplicate protection is the database's partial unique index
 * `players_registration_id_key`, so two admins racing can never create two
 * players for one seat. The optional RPC in `db/phase2_registration_assignment.sql`
 * adds server-side status/session validation; until it is applied the client
 * performs the same checks and falls back to the admin-only direct insert.
 */

type PlayersInsert = Database["public"]["Tables"]["players"]["Insert"];

export const ASSIGNABLE_REGISTRATION_STATUSES: readonly RegistrationStatus[] = [
  "paid",
  "profile_required",
  "confirmed",
];

export interface RegistrationPoolProfile {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export interface RegistrationPoolRow {
  id: string;
  session_id: string | null;
  seat_index: number;
  status: RegistrationStatus;
  participant_name: string | null;
  participant_email: string | null;
  profile_id: string | null;
  purchaser_profile_id: string | null;
  created_at: string;
  profile: RegistrationPoolProfile | null;
  purchaser: RegistrationPoolProfile | null;
  order: { shopify_order_name: string | null; purchaser_email: string | null } | null;
}

export type RosterTarget =
  | { kind: "court"; courtId: number }
  | { kind: "group"; groupId: string };

export interface AssignRegistrationResult {
  status: "assigned" | "already_assigned";
  playerId: string | null;
  via: "rpc" | "insert";
}

interface DbError {
  code?: string;
  message: string;
  details?: string | null;
}

const joinName = (first?: string | null, last?: string | null): string | null => {
  const value = [first?.trim(), last?.trim()].filter(Boolean).join(" ").trim();
  return value.length > 0 ? value : null;
};

export function isAssignableStatus(status: string | null | undefined): boolean {
  return ASSIGNABLE_REGISTRATION_STATUSES.includes(status as RegistrationStatus);
}

/**
 * Roster name precedence: participant profile (first + optional last) →
 * participant_name captured at checkout → purchaser profile name → null
 * (admin must type one before assigning).
 */
export function resolveRosterName(row: {
  profile?: RegistrationPoolProfile | null;
  participant_name?: string | null;
  purchaser?: RegistrationPoolProfile | null;
}): string | null {
  return (
    joinName(row.profile?.first_name, row.profile?.last_name) ??
    (row.participant_name?.trim() ? row.participant_name.trim() : null) ??
    joinName(row.purchaser?.first_name, row.purchaser?.last_name)
  );
}

/** Email an admin can use to resolve who a seat belongs to (never written to players). */
export function resolveContactEmail(row: {
  participant_email?: string | null;
  profile?: RegistrationPoolProfile | null;
  order?: { purchaser_email: string | null } | null;
  purchaser?: RegistrationPoolProfile | null;
}): string | null {
  return (
    row.participant_email?.trim() ||
    row.profile?.email?.trim() ||
    row.order?.purchaser_email?.trim() ||
    row.purchaser?.email?.trim() ||
    null
  );
}

const asDbError = (err: unknown): DbError => {
  if (err && typeof err === "object") {
    const e = err as { code?: unknown; message?: unknown; details?: unknown };
    return {
      code: typeof e.code === "string" ? e.code : undefined,
      message: typeof e.message === "string" ? e.message : String(err),
      details: typeof e.details === "string" ? e.details : null,
    };
  }
  return { message: String(err) };
};

/** The seat already has a player (partial unique index on players.registration_id). */
export function isDuplicateRegistrationError(err: unknown): boolean {
  const e = asDbError(err);
  const text = `${e.message} ${e.details ?? ""}`;
  return (e.code === "23505" || /duplicate key/i.test(text)) && /registration_id/i.test(text);
}

/** Same roster already has a player with this (case-insensitive) name. */
export function isDuplicateNameError(err: unknown): boolean {
  const e = asDbError(err);
  const text = `${e.message} ${e.details ?? ""}`;
  return (
    (e.code === "23505" || /duplicate key/i.test(text)) &&
    /players_session_(court|group)_name_idx|lower\(name\)|\(name\)/i.test(text)
  );
}

/** The assignment RPC has not been applied to the database yet. */
export function isMissingRpcError(err: unknown): boolean {
  const e = asDbError(err);
  return (
    e.code === "PGRST202" ||
    e.code === "42883" ||
    /could not find the function/i.test(e.message) ||
    /function .* does not exist/i.test(e.message)
  );
}

export function isEndedSessionError(err: unknown): boolean {
  const e = asDbError(err);
  return e.code === "55000" || /archived and cannot be modified/i.test(e.message);
}

interface RpcResponse {
  ok: boolean;
  status?: "assigned" | "already_assigned";
  player_id?: string | null;
  error?: string;
}

/** Minimal surface used for assignment so tests can inject a fake client. */
export interface AssignmentClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: DbError | null }>;
  from: (table: "players") => {
    insert: (row: PlayersInsert) => {
      select: (columns: string) => {
        single: () => PromiseLike<{ data: { id: string } | null; error: DbError | null }>;
      };
    };
  };
}

export interface AssignRegistrationArgs {
  registration: Pick<RegistrationPoolRow, "id" | "session_id" | "status" | "profile_id">;
  sessionId: string;
  target: RosterTarget;
  /** Final roster name (already resolved or typed by the admin). */
  name: string;
  client?: AssignmentClient;
}

export async function assignRegistrationToRoster({
  registration,
  sessionId,
  target,
  name,
  client,
}: AssignRegistrationArgs): Promise<AssignRegistrationResult> {
  const db = client ?? (supabase as unknown as AssignmentClient);
  const rosterName = name.trim();

  if (!sessionId) throw new Error("No active session for this roster.");
  if (registration.session_id !== sessionId) {
    throw new Error("This registration belongs to a different session.");
  }
  if (!isAssignableStatus(registration.status)) {
    throw new Error(`Registration is ${registration.status} and cannot be added to a roster.`);
  }
  if (!rosterName) throw new Error("Enter a roster name before adding this player.");

  const courtId = target.kind === "court" ? target.courtId : null;
  const groupId = target.kind === "group" ? target.groupId : null;

  // Preferred path: atomic server-side assignment (validates status, session,
  // court/group ownership and returns idempotently when already assigned).
  const rpc = await db.rpc("assign_registration_to_roster", {
    p_registration_id: registration.id,
    p_session_id: sessionId,
    p_court_id: courtId,
    p_group_id: groupId,
    p_name: rosterName,
  });

  if (!rpc.error) {
    const result = (rpc.data ?? {}) as RpcResponse;
    if (!result.ok) throw new Error(result.error || "Could not add this registration to the roster.");
    return {
      status: result.status === "already_assigned" ? "already_assigned" : "assigned",
      playerId: result.player_id ?? null,
      via: "rpc",
    };
  }

  if (!isMissingRpcError(rpc.error)) {
    throw new Error(rpc.error.message);
  }

  // Fallback (RPC not applied yet): the same guarded write the admin roster
  // already performs, plus the two linkage columns. RLS keeps this admin-only
  // and the partial unique index guarantees one player per registration.
  const { data, error } = await db
    .from("players")
    .insert({
      session_id: sessionId,
      court_id: courtId,
      group_id: groupId,
      name: rosterName,
      is_guest: false,
      added_by_admin: true,
      profile_id: registration.profile_id,
      registration_id: registration.id,
    })
    .select("id")
    .single();

  if (error) {
    if (isDuplicateRegistrationError(error)) {
      return { status: "already_assigned", playerId: null, via: "insert" };
    }
    throw error;
  }

  return { status: "assigned", playerId: data?.id ?? null, via: "insert" };
}

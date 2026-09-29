/**
 * Seat ledger helpers. One non-terminal experience_registrations row mapped to a
 * session = one capacity-consuming seat, regardless of source.
 */
export const MANUAL_SEAT_SOURCES = ["offline_paid", "complimentary", "invite", "walk_in", "manual"] as const;
export type ManualSeatSource = (typeof MANUAL_SEAT_SOURCES)[number];
export type SeatSource = "shopify" | ManualSeatSource;

export const SEAT_SOURCE_LABEL: Record<string, string> = {
  shopify: "Shopify",
  offline_paid: "Offline paid",
  complimentary: "Complimentary",
  invite: "Invite",
  walk_in: "Walk-in",
  manual: "Manual/Other",
};

export const ACTIVE_SEAT_STATUSES = ["paid", "profile_required", "confirmed"] as const;

export interface SeatLike {
  status: string;
  seat_source?: string | null;
  session_id?: string | null;
  cancelled_at?: string | null;
  refunded_at?: string | null;
}

/** Mirrors public.session_booked_seats. */
export function isActiveSeat(row: SeatLike): boolean {
  return (
    Boolean(row.session_id) &&
    (ACTIVE_SEAT_STATUSES as readonly string[]).includes(row.status) &&
    !row.cancelled_at &&
    !row.refunded_at
  );
}

export function summarizeSeats(rows: readonly SeatLike[], capacity: number | null) {
  const active = rows.filter(isActiveSeat);
  const bySource: Record<string, number> = {};
  active.forEach((r) => {
    const s = r.seat_source ?? "shopify";
    bySource[s] = (bySource[s] ?? 0) + 1;
  });
  const occupied = active.length;
  return {
    occupied,
    capacity,
    available: capacity == null ? null : Math.max(0, capacity - occupied),
    overCapacity: capacity != null && occupied > capacity,
    bySource,
  };
}

/** Client-side mirror of the admin_add_manual_seat capacity gate. */
export function canAddSeat(occupied: number, capacity: number | null, allowOverCapacity = false): boolean {
  return capacity == null || occupied < capacity || allowOverCapacity;
}

/**
 * Staff role model. Mirrors public.has_permission() in the database, which is
 * the real enforcement point — this file only drives what the UI shows.
 * Scope (city/locality) can later be layered on top of `can` without changing callers.
 */
export const STAFF_ROLES = ["owner", "admin", "host", "viewer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type Permission =
  | "admin.read"
  | "event.operate"
  | "seats.manage"
  | "schedule.manage"
  | "capacity.manage"
  | "social.create"
  | "shopify.manage"
  | "roles.manage";

const PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  owner: ["admin.read", "event.operate", "seats.manage", "schedule.manage", "capacity.manage", "social.create", "shopify.manage", "roles.manage"],
  admin: ["admin.read", "event.operate", "seats.manage", "schedule.manage", "capacity.manage", "social.create", "shopify.manage"],
  host: ["admin.read", "event.operate", "seats.manage"],
  viewer: ["admin.read"],
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  host: "Host",
  viewer: "Viewer",
};

const RANK: Record<StaffRole, number> = { owner: 1, admin: 2, host: 3, viewer: 4 };

export function isStaffRole(r: unknown): r is StaffRole {
  return typeof r === "string" && (STAFF_ROLES as readonly string[]).includes(r);
}

/** Highest-privilege staff role among a user's role rows, or null. */
export function highestRole(roles: readonly string[]): StaffRole | null {
  const staff = roles.filter(isStaffRole);
  if (!staff.length) return null;
  return staff.sort((a, b) => RANK[a] - RANK[b])[0];
}

export function can(role: StaffRole | null, permission: Permission): boolean {
  return !!role && PERMISSIONS[role].includes(permission);
}

/** Last-owner guard used by the role UI (DB trigger + function enforce it too). */
export function wouldRemoveLastOwner(
  staff: readonly { user_id: string; role: string }[],
  userId: string,
  nextRole: StaffRole | null,
): boolean {
  const target = staff.find((s) => s.user_id === userId);
  if (!target || target.role !== "owner" || nextRole === "owner") return false;
  return staff.filter((s) => s.role === "owner").length <= 1;
}

/** Where the admin area should send someone. */
export function adminEntryDestination(role: StaffRole | null, hasContext: boolean): string {
  if (!role) return "/admin/login";
  return hasContext ? "/admin" : "/admin/home";
}

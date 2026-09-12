/**
 * Helpers for the Goosepick-branded magic-link verification route (`/auth/verify`).
 *
 * The email template links to our own domain and carries a one-time
 * `token_hash` plus the auth `type`. Nothing else in the link is a secret.
 */

/** Auth types this participant sign-in flow is allowed to verify. */
export const ALLOWED_VERIFY_TYPES = ["magiclink", "email", "signup", "recovery"] as const;

export type VerifyEmailType = (typeof ALLOWED_VERIFY_TYPES)[number];

export const VERIFY_PATH = "/auth/verify";

/** Where a successful verification continues to when no return path is given. */
export const DEFAULT_VERIFY_NEXT = "/my";

export interface ParsedVerifyParams {
  tokenHash: string;
  type: VerifyEmailType;
  next: string;
}

export function isAllowedVerifyType(value: string | null): value is VerifyEmailType {
  return value !== null && (ALLOWED_VERIFY_TYPES as readonly string[]).includes(value);
}

/**
 * Only same-app absolute paths are accepted as a return target, so the link can
 * never be used to bounce a signed-in participant to a foreign host.
 */
export function sanitizeNextPath(value: string | null): string {
  if (!value) return DEFAULT_VERIFY_NEXT;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_VERIFY_NEXT;
  if (value.startsWith("/auth")) return DEFAULT_VERIFY_NEXT;
  return value;
}

/**
 * Strict parse of the verification query string. Returns null when the link is
 * missing or carries an unsupported token/type.
 */
export function parseVerifyParams(search: string): ParsedVerifyParams | null {
  const params = new URLSearchParams(search);
  const tokenHash = (params.get("token_hash") || "").trim();
  const type = params.get("type");
  if (!tokenHash || !isAllowedVerifyType(type)) return null;
  return { tokenHash, type, next: sanitizeNextPath(params.get("next")) };
}

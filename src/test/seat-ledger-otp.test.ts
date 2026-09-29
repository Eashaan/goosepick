import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { rootDestination } from "@/pages/Index";
import { isValidOtp, OTP_LENGTH, RESEND_COOLDOWN_SECONDS } from "@/pages/participant/ParticipantLogin";
import { parseVerifyParams, sanitizeNextPath } from "@/lib/authVerify";
import { canAddSeat, isActiveSeat, summarizeSeats } from "@/lib/seatLedger";
import { guestSeatLabel, resolveRosterName } from "@/lib/registrationAssignment";

const read = (p: string) => readFileSync(p, "utf8");
const purchaser = { first_name: "Asha", last_name: "Mehta", email: null };

describe("root portal", () => {
  it("routes signed-in users to /my and others to sign-in", () => {
    expect(rootDestination(true)).toBe("/my");
    expect(rootDestination(false)).toBe("/auth");
  });
  it("keeps public and admin routes", () => {
    const app = read("src/App.tsx");
    ["/public", "/public/court/:courtId", "/public/group/:groupId", "/admin/login", "/auth/verify"].forEach((r) =>
      expect(app).toContain(`path="${r}"`),
    );
  });
});

describe("OTP login", () => {
  it("accepts exactly 6 digits", () => {
    expect(OTP_LENGTH).toBe(6);
    expect(isValidOtp("123456")).toBe(true);
    expect(isValidOtp("12345")).toBe(false);
    expect(isValidOtp("12a456")).toBe(false);
    expect(RESEND_COOLDOWN_SECONDS).toBeGreaterThanOrEqual(30);
  });
  it("verifies with email/token/type=email and keeps magic link", () => {
    const hook = read("src/hooks/useParticipantAuth.tsx");
    expect(hook).toMatch(/verifyOtp\(\{[\s\S]*type: "email"/);
    expect(hook).toContain("signInWithOtp");
    expect(hook).toContain("emailRedirectTo");
  });
  it("safe return path preserved", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/my");
    expect(sanitizeNextPath("/my/experience/x")).toBe("/my/experience/x");
    expect(parseVerifyParams("?token_hash=abc&type=magiclink")?.type).toBe("magiclink");
  });
  it("email template carries both code and link", () => {
    const tpl = read("supabase/functions/_shared/email-templates/magic-link.tsx");
    expect(tpl).toContain("{token}");
    expect(tpl).toContain("href={confirmationUrl}");
    expect(read("supabase/functions/auth-email-hook/index.ts")).toContain("token: data.token");
  });
});

describe("seat ledger capacity", () => {
  const manual = { status: "confirmed", seat_source: "walk_in", session_id: "s" };
  it("manual seat consumes capacity; cancelled releases", () => {
    expect(summarizeSeats([manual], 1).occupied).toBe(1);
    expect(isActiveSeat({ ...manual, status: "cancelled", cancelled_at: "now" })).toBe(false);
    expect(summarizeSeats([{ ...manual, status: "cancelled" }], 1).available).toBe(1);
  });
  it("unmapped/refunded do not count", () => {
    expect(isActiveSeat({ status: "unmapped", session_id: null })).toBe(false);
    expect(isActiveSeat({ status: "refunded", session_id: "s" })).toBe(false);
  });
  it("over capacity blocked unless override", () => {
    expect(canAddSeat(4, 4)).toBe(false);
    expect(canAddSeat(4, 4, true)).toBe(true);
    expect(canAddSeat(99, null)).toBe(true);
    expect(summarizeSeats([manual, manual], 1).overCapacity).toBe(true);
  });
  it("source breakdown", () => {
    const s = summarizeSeats([manual, { status: "paid", session_id: "s" }], null);
    expect(s.bySource).toEqual({ walk_in: 1, shopify: 1 });
  });
});

describe("multi-ticket guest labels", () => {
  it("labels seats 2..N as Guest 1..N-1", () => {
    [2, 3, 4].forEach((seat) =>
      expect(
        resolveRosterName({ seat_index: seat, profile: null, profile_id: null, participant_name: null, purchaser }),
      ).toBe(`Asha Mehta's Guest ${seat - 1}`),
    );
    expect(guestSeatLabel(null, 2)).toBe("Purchaser's Guest 1");
  });
  it("seat 1 stays purchaser; rename wins", () => {
    expect(resolveRosterName({ seat_index: 1, profile: null, participant_name: null, purchaser })).toBe("Asha Mehta");
    expect(resolveRosterName({ seat_index: 2, profile: null, participant_name: "Ravi", purchaser })).toBe("Ravi");
  });
  it("manual seats never get guest labels", () => {
    expect(
      resolveRosterName({ seat_index: 3, seat_source: "walk_in", profile: null, participant_name: "Walk In", purchaser: null }),
    ).toBe("Walk In");
  });
});

describe("seat manager wiring", () => {
  it("uses RPCs, no Shopify linkage edits, no roster creation", () => {
    const src = read("src/components/admin/SeatManager.tsx");
    expect(src).toContain("admin_add_manual_seat");
    expect(src).toContain("admin_update_seat");
    expect(src).toContain("admin_cancel_manual_seat");
    expect(src).not.toMatch(/commerce_order_id|shopify_line_item_id|mapping_id/);
    expect(src).not.toMatch(/from\("players"\)/);
  });
  it("pool reads seat source and uses Seats wording", () => {
    expect(read("src/hooks/useRegistrationPool.ts")).toContain("seat_source");
    expect(read("src/components/admin/RegistrationPool.tsx")).not.toContain("Online registrations");
  });
});

import { describe, it, expect } from "vitest";
import {
  ADMIN_OTP_LENGTH,
  ADMIN_RESEND_COOLDOWN_SECONDS,
  isValidAdminOtp,
} from "@/pages/admin/AdminLogin";

describe("admin OTP login", () => {
  it("uses a 6-digit code with a 60s resend cooldown", () => {
    expect(ADMIN_OTP_LENGTH).toBe(6);
    expect(ADMIN_RESEND_COOLDOWN_SECONDS).toBe(60);
  });

  it("accepts only six digits", () => {
    expect(isValidAdminOtp("123456")).toBe(true);
    expect(isValidAdminOtp("12345")).toBe(false);
    expect(isValidAdminOtp("1234567")).toBe(false);
    expect(isValidAdminOtp("12345a")).toBe(false);
    expect(isValidAdminOtp("")).toBe(false);
  });
});

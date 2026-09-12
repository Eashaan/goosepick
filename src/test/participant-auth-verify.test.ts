import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ALLOWED_VERIFY_TYPES,
  DEFAULT_VERIFY_NEXT,
  VERIFY_PATH,
  isAllowedVerifyType,
  parseVerifyParams,
  sanitizeNextPath,
} from "@/lib/authVerify";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("participant magic-link verification route", () => {
  it("parses a valid branded verification link", () => {
    const parsed = parseVerifyParams("?token_hash=abc123&type=magiclink");
    expect(parsed).toEqual({ tokenHash: "abc123", type: "magiclink", next: DEFAULT_VERIFY_NEXT });
  });

  it("preserves an in-app return path", () => {
    const parsed = parseVerifyParams(
      "?token_hash=abc123&type=email&next=%2Fmy%2Fexperience%2F37eade31",
    );
    expect(parsed?.next).toBe("/my/experience/37eade31");
  });

  it("rejects missing token hash or type", () => {
    expect(parseVerifyParams("?type=magiclink")).toBeNull();
    expect(parseVerifyParams("?token_hash=abc123")).toBeNull();
    expect(parseVerifyParams("")).toBeNull();
    expect(parseVerifyParams("?token_hash=%20%20&type=magiclink")).toBeNull();
  });

  it("only allows email/magic-link auth types", () => {
    expect(ALLOWED_VERIFY_TYPES).toEqual(["magiclink", "email", "signup", "recovery"]);
    expect(isAllowedVerifyType("magiclink")).toBe(true);
    expect(isAllowedVerifyType("phone_change")).toBe(false);
    expect(parseVerifyParams("?token_hash=abc&type=sms")).toBeNull();
  });

  it("never lets a link redirect off-app or loop back into auth", () => {
    expect(sanitizeNextPath("https://evil.example.com")).toBe(DEFAULT_VERIFY_NEXT);
    expect(sanitizeNextPath("//evil.example.com")).toBe(DEFAULT_VERIFY_NEXT);
    expect(sanitizeNextPath("/auth/verify?token_hash=x")).toBe(DEFAULT_VERIFY_NEXT);
    expect(sanitizeNextPath(null)).toBe(DEFAULT_VERIFY_NEXT);
    expect(sanitizeNextPath("/my/profile")).toBe("/my/profile");
  });

  it("registers the route and keeps the legacy callback path", () => {
    const app = read("src/App.tsx");
    expect(VERIFY_PATH).toBe("/auth/verify");
    expect(app).toContain('path="/auth/verify"');
    expect(app).toContain('path="/auth/callback"');
  });

  it("verifies via the supported token-hash method then continues through the callback", () => {
    const page = read("src/pages/participant/AuthVerify.tsx");
    expect(page).toContain("supabase.auth.verifyOtp");
    expect(page).toContain("token_hash: parsed.tokenHash");
    expect(page).toContain("/auth/callback?next=");
  });

  it("keeps signInWithOtp so existing default provider links still work", () => {
    const hook = read("src/hooks/useParticipantAuth.tsx");
    expect(hook).toContain("signInWithOtp");
    expect(hook).toContain("/auth/callback");
  });

  it("exposes no vendor host in customer-facing auth surfaces", () => {
    const files = [
      "src/pages/participant/AuthVerify.tsx",
      "src/pages/participant/AuthCallback.tsx",
      "src/pages/participant/ParticipantLogin.tsx",
      "src/lib/authVerify.ts",
    ];
    for (const file of files) {
      const contents = read(file);
      expect(contents.toLowerCase()).not.toContain("lovable.cloud");
      expect(contents.toLowerCase()).not.toContain("supabase.co");
    }
  });
});

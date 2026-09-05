import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const app = read("src/App.tsx");
const sql = read("db/phase1_participant_accounts.sql");

describe("participant accounts — routing", () => {
  it("keeps every legacy public/admin route intact", () => {
    for (const path of [
      '<Route path="/" ',
      '"/admin/login"',
      '"/admin"',
      '"/admin/court/:courtId"',
      '"/admin/group/:groupId"',
      '"/public"',
      '"/public/court/:courtId"',
      '"/public/group/:groupId"',
    ]) {
      expect(app).toContain(path);
    }
  });

  it("adds the participant routes", () => {
    expect(app).toContain('"/auth"');
    expect(app).toContain('"/auth/callback"');
    expect(app).toContain('"/my"');
    expect(app).toContain('"/my/profile"');
    expect(app).toContain("ParticipantAuthProvider");
  });

  it("guards /my and allows an incomplete profile only on /my/profile", () => {
    const guard = read("src/pages/participant/RequireParticipant.tsx");
    expect(guard).toContain('navigate("/auth"');
    expect(guard).toContain('navigate("/my/profile"');
    expect(app).toContain("requireCompleteProfile={false}");
  });

  it("uses passwordless OTP and never assumes authenticated means admin", () => {
    const hook = read("src/hooks/useParticipantAuth.tsx");
    expect(hook).toContain("signInWithOtp");
    expect(hook).toContain("/auth/callback");
    expect(hook).not.toContain("user_roles");
    expect(hook).not.toContain("is_admin");
  });

  it("leaves existing admin auth untouched", () => {
    const adminAuth = read("src/hooks/useAdminAuth.tsx");
    expect(adminAuth).toContain('.from("user_roles")');
    expect(adminAuth).toContain("signInWithPassword");
  });

  it("exchanges the PKCE code itself, never the full callback URL", () => {
    const callback = read("src/pages/participant/AuthCallback.tsx");
    expect(callback).toContain('const code = url.searchParams.get("code")');
    expect(callback).toContain("supabase.auth.exchangeCodeForSession(code)");
    expect(callback).not.toMatch(/exchangeCodeForSession\(\s*window\.location\.href\s*\)/);
    expect(callback).not.toMatch(/exchangeCodeForSession\(\s*url\.(href|toString\(\))\s*\)/);
  });
});

describe("participant accounts — schema guards", () => {
  it("enables RLS on every new table", () => {
    for (const table of [
      "participant_profiles",
      "commerce_orders",
      "shopify_session_mappings",
      "experience_registrations",
    ]) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`GRANT ALL ON public.${table} TO service_role`);
    }
  });

  it("grants no anonymous access to PII tables", () => {
    expect(sql).not.toMatch(/TO\s+anon/i);
    expect(sql).not.toMatch(/GRANT[^;]*\banon\b/i);
    // Every policy is scoped to the authenticated role.
    const policyCount = (sql.match(/CREATE POLICY/g) || []).length;
    const authenticatedScoped = (sql.match(/TO authenticated/g) || []).length;
    expect(policyCount).toBeGreaterThan(0);
    expect(authenticatedScoped).toBeGreaterThanOrEqual(policyCount);
  });

  it("keeps one seat per shopify line item", () => {
    expect(sql).toContain("UNIQUE (shopify_line_item_id, seat_index)");
    expect(sql).toContain("CHECK (seat_index >= 1)");
  });

  it("stores only source-of-truth registration states", () => {
    expect(sql).toContain(
      "CHECK (status IN ('paid', 'profile_required', 'confirmed', 'cancelled', 'refunded', 'unmapped'))",
    );
    expect(sql).not.toContain("'roster_pending'");
    expect(sql).not.toContain("'roster_ready'");
  });

  it("links players additively and never destructively", () => {
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS profile_id uuid");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS registration_id uuid");
    expect(sql).toContain("players_registration_id_key");
    expect(sql).not.toMatch(/DROP\s+(TABLE|POLICY|COLUMN)/i);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("never stores a plaintext claim token", () => {
    expect(sql).toContain("claim_token_hash text");
    expect(sql).not.toMatch(/claim_token\s+text/);
  });

  it("resolves sessions through immutable mapping identifiers only", () => {
    expect(sql).toContain("mapping_key text NOT NULL UNIQUE");
    expect(sql).toContain("shopify_product_id text NOT NULL");
    expect(sql).toContain("shopify_session_mappings_occurrence_key");
  });
});

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

  it("additively alters players (nullable links only) and never mutates existing data", () => {
    // players is the ONLY pre-existing table touched, and only with new nullable columns.
    const alterStatements = sql.match(/ALTER TABLE public\.(\w+)\s+ADD COLUMN/g) || [];
    expect(alterStatements).toHaveLength(1);
    expect(alterStatements[0]).toContain("public.players");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES public.participant_profiles(id)");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS registration_id uuid REFERENCES public.experience_registrations(id)");
    expect(sql).not.toMatch(/ADD COLUMN[^;]*\bNOT NULL\b/i);
    expect(sql).toContain("players_registration_id_key");
    expect(sql).not.toMatch(/ALTER TABLE public\.\w+\s+(DROP|ALTER COLUMN|RENAME)/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|POLICY|COLUMN|FUNCTION|TRIGGER)/i);
    expect(sql).not.toMatch(/\bDELETE FROM\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+public\.\w+\s+SET\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
  });

  it("binds participant profile writes to the JWT identity and email", () => {
    const emailBinding = "lower(email) = lower(COALESCE(auth.jwt() ->> 'email', ''))";
    const insertPolicy = sql.match(
      /CREATE POLICY "Participants can create their own profile"[\s\S]*?WITH CHECK \(([\s\S]*?)\);/,
    );
    const updatePolicy = sql.match(
      /CREATE POLICY "Participants can update their own profile"[\s\S]*?WITH CHECK \(([\s\S]*?)\);/,
    );
    expect(insertPolicy).not.toBeNull();
    expect(updatePolicy).not.toBeNull();
    for (const check of [insertPolicy![1], updatePolicy![1]]) {
      expect(check).toContain("user_id = auth.uid()");
      expect(check).toContain(emailBinding);
      expect(check).toMatch(/user_id = auth\.uid\(\)\s+AND\s+lower\(email\)/);
    }
    // Admins stay read-only on profiles; clients can never delete.
    expect(sql).toContain("GRANT SELECT, INSERT, UPDATE ON public.participant_profiles TO authenticated");
    expect(sql).not.toMatch(/GRANT[^;]*\bDELETE\b[^;]*ON public\.participant_profiles/i);
    expect(sql).not.toMatch(/CREATE POLICY[^;]*ON public\.participant_profiles FOR DELETE/i);
  });

  it("locks down the SECURITY DEFINER profile helper from PUBLIC", () => {
    const fn = "public.current_participant_profile_id()";
    const definition = sql.indexOf(`CREATE OR REPLACE FUNCTION ${fn}`);
    const revoke = sql.indexOf(`REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;`);
    const grant = sql.indexOf(`GRANT EXECUTE ON FUNCTION ${fn} TO authenticated, service_role;`);
    expect(definition).toBeGreaterThan(-1);
    expect(revoke).toBeGreaterThan(definition);
    expect(grant).toBeGreaterThan(revoke);
    // Revoking only from anon would leave the default PUBLIC EXECUTE grant in place.
    expect(sql).not.toMatch(/REVOKE[^;]*ON FUNCTION[^;]*FROM\s+anon\s*;/i);
    // Every SECURITY DEFINER function in this file must be revoked from PUBLIC.
    const functionBodies = sql.match(/CREATE OR REPLACE FUNCTION public\.\w+\([^)]*\)[\s\S]*?\$\$;/g) || [];
    const definers = functionBodies
      .filter((body) => /SECURITY DEFINER/.test(body))
      .map((body) => body.match(/FUNCTION (public\.\w+\([^)]*\))/)![1]);
    expect(definers).toEqual([fn]);
    for (const name of definers) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${name} FROM PUBLIC;`);
    }
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

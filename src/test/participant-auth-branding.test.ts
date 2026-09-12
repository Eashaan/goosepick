import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Visible copy only: strip imports, comments and JSX/TS identifiers we don't render. */
const visibleText = (source: string) =>
  source
    .split("\n")
    .filter((line) => !/^\s*(import|\*|\/\/|\/\*)/.test(line))
    .filter((line) => !/@\/integrations\/supabase|@supabase\/supabase-js/.test(line))
    .join("\n");

describe("participant auth — magic link redirect target", () => {
  it("sends the sign-in link back to the app's own /auth/callback origin", () => {
    const hook = read("src/hooks/useParticipantAuth.tsx");
    expect(hook).toContain('export const PARTICIPANT_REDIRECT_PATH = "/auth/callback"');
    expect(hook).toContain("emailRedirectTo: `${window.location.origin}${PARTICIPANT_REDIRECT_PATH}`");
    // Never hardcode a vendor or preview host in the redirect.
    expect(hook).not.toMatch(/lovable\.(app|dev|cloud)/i);
    expect(hook).not.toMatch(/https:\/\/[a-z0-9]+\.supabase\.co/i);
  });

  it("preserves the deep-link return path through profile completion", () => {
    const guard = read("src/pages/participant/RequireParticipant.tsx");
    expect(guard).toContain("state: { from: `${location.pathname}${location.search}` }");
  });
});

describe("participant auth — no visible vendor branding", () => {
  const pages = [
    "src/pages/participant/ParticipantLogin.tsx",
    "src/pages/participant/AuthCallback.tsx",
    "src/pages/participant/MyGoosepick.tsx",
    "src/pages/participant/MyProfile.tsx",
    "src/pages/participant/MyExperience.tsx",
    "src/pages/participant/RequireParticipant.tsx",
  ];

  for (const page of pages) {
    it(`keeps ${page} free of vendor names and raw infrastructure URLs`, () => {
      const text = visibleText(read(page));
      expect(text).not.toMatch(/lovable/i);
      expect(text).not.toMatch(/auth\.lovable\.cloud/i);
      expect(text).not.toMatch(/supabase\.co/i);
    });
  }

  it("keeps document metadata Goosepick-branded", () => {
    const html = read("index.html");
    expect(html).not.toMatch(/lovable/i);
    expect(html).toContain('content="Goosepick"');
  });
});

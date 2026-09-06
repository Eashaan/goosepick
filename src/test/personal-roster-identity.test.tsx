import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Database } from "@/integrations/supabase/types";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("html2canvas", () => ({ default: vi.fn() }));

import PersonalRoster from "@/components/public/PersonalRoster";

type Player = Database["public"]["Tables"]["players"]["Row"];

const player = (id: string, name: string): Player => ({
  id,
  name,
  court_id: 4,
  group_id: null,
  session_id: "sess-1",
  is_guest: false,
  added_by_admin: true,
  created_at: "2026-09-05T00:00:00Z",
  profile_id: null,
  registration_id: id === "p-asha" ? "reg-1" : null,
});

const players = [player("p-asha", "Asha Mehta"), player("p-rohan", "Rohan")];

let container: HTMLDivElement;
let root: Root;

const mount = (element: React.ReactElement) => {
  act(() => {
    root.render(element);
  });
  return container.textContent ?? "";
};

describe("PersonalRoster identity override", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("legacy /public: asks for a name when nothing is saved", () => {
    const text = mount(<PersonalRoster courtId={4} players={players} matches={[]} courtState={undefined} />);
    expect(text).toContain("Please select your name in the dropdown below");
    expect(text).not.toContain("Playing as");
  });

  it("legacy /public: restores a previously saved player and offers Change Player", () => {
    localStorage.setItem("gp_no-session_court-4_person", "p-rohan");
    const text = mount(<PersonalRoster courtId={4} players={players} matches={[]} courtState={undefined} />);
    expect(text).toContain("Playing as");
    expect(text).toContain("Rohan");
    expect(text).toContain("Change Player");
  });

  it("linked registration: skips the name selector, pins the player, and leaves localStorage alone", () => {
    localStorage.setItem("gp_no-session_court-4_person", "p-rohan"); // stale legacy choice must not win
    const text = mount(
      <PersonalRoster courtId={4} players={players} matches={[]} courtState={undefined} fixedPlayerId="p-asha" archived />,
    );
    expect(text).not.toContain("Please select your name in the dropdown below");
    expect(text).toContain("Playing as");
    expect(text).toContain("Asha Mehta");
    expect(text).not.toContain("Change Player");
    // The fixed identity is never persisted over the legacy selection.
    expect(localStorage.getItem("gp_no-session_court-4_person")).toBe("p-rohan");
  });

  it("linked registration: shows a loading state until the pinned player is in the roster data", () => {
    const text = mount(<PersonalRoster courtId={4} players={[]} matches={[]} courtState={undefined} fixedPlayerId="p-asha" />);
    expect(text).toContain("Loading your roster...");
    expect(text).not.toContain("Please select your name in the dropdown below");
  });
});

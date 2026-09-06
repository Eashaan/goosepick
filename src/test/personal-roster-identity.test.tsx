import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("PersonalRoster identity override", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("legacy /public: asks for a name and remembers the choice in localStorage", () => {
    render(<PersonalRoster courtId={4} players={players} matches={[]} courtState={undefined} />);
    expect(screen.getByText("Please select your name in the dropdown below")).toBeInTheDocument();
    expect(screen.queryByText("Playing as")).not.toBeInTheDocument();
  });

  it("legacy /public: restores a previously saved player and offers Change Player", () => {
    localStorage.setItem("gp_no-session_court-4_person", "p-rohan");
    render(<PersonalRoster courtId={4} players={players} matches={[]} courtState={undefined} />);
    expect(screen.getByText("Playing as")).toBeInTheDocument();
    expect(screen.getByText("Rohan")).toBeInTheDocument();
    expect(screen.getByText("Change Player")).toBeInTheDocument();
  });

  it("linked registration: skips the name selector, pins the player, and leaves localStorage alone", () => {
    localStorage.setItem("gp_no-session_court-4_person", "p-rohan"); // stale legacy choice must not win
    render(
      <PersonalRoster courtId={4} players={players} matches={[]} courtState={undefined} fixedPlayerId="p-asha" archived />,
    );
    expect(screen.queryByText("Please select your name in the dropdown below")).not.toBeInTheDocument();
    expect(screen.getByText("Playing as")).toBeInTheDocument();
    expect(screen.getByText("Asha Mehta")).toBeInTheDocument();
    expect(screen.queryByText("Change Player")).not.toBeInTheDocument();
    // The fixed identity is never persisted over the legacy selection.
    expect(localStorage.getItem("gp_no-session_court-4_person")).toBe("p-rohan");
  });

  it("linked registration: shows a loading state until the pinned player is in the roster data", () => {
    render(<PersonalRoster courtId={4} players={[]} matches={[]} courtState={undefined} fixedPlayerId="p-asha" />);
    expect(screen.getByText("Loading your roster...")).toBeInTheDocument();
    expect(screen.queryByText("Please select your name in the dropdown below")).not.toBeInTheDocument();
  });
});

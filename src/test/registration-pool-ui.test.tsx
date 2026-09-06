import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RegistrationPoolRow } from "@/lib/registrationAssignment";
import type { RegistrationPoolData } from "@/hooks/useRegistrationPool";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const assignMock = vi.fn();
vi.mock("@/lib/registrationAssignment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/registrationAssignment")>();
  return { ...actual, assignRegistrationToRoster: (...args: unknown[]) => assignMock(...args) };
});

const poolState: { data: RegistrationPoolData | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
vi.mock("@/hooks/useRegistrationPool", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRegistrationPool")>();
  return { ...actual, useRegistrationPool: () => poolState };
});

import RegistrationPool, { RegistrationPoolSummary } from "@/components/admin/RegistrationPool";

const reg = (overrides: Partial<RegistrationPoolRow>): RegistrationPoolRow => ({
  id: "reg-a",
  session_id: "sess-1",
  seat_index: 1,
  status: "paid",
  participant_name: null,
  participant_email: null,
  profile_id: "prof-a",
  purchaser_profile_id: null,
  created_at: "2026-09-05T00:00:00Z",
  profile: { first_name: "Asha", last_name: "Mehta", email: "asha@example.com" },
  purchaser: null,
  order: { shopify_order_name: "#1042", purchaser_email: "asha@example.com" },
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

const mount = (element: React.ReactElement) => {
  act(() => {
    root.render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  });
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("RegistrationPool (admin Players card)", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    assignMock.mockReset();
    client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    poolState.data = undefined;
    poolState.isLoading = false;
    poolState.isError = false;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders nothing for sessions without online registrations (legacy pages unchanged)", () => {
    poolState.data = { registrations: [], assigned: new Map(), waiting: [] };
    mount(
      <RegistrationPool sessionId="sess-1" target={{ kind: "court", courtId: 1 }} currentPlayerNames={[]} capacityRemaining={12} />,
    );
    expect(container.textContent).toBe("");
  });

  it("lists waiting seats with name, email, seat/order and status, and assigns into the target roster", async () => {
    const waiting = [
      reg({}),
      reg({ id: "reg-b", seat_index: 2, profile_id: null, profile: null, participant_email: "guest@example.com", status: "profile_required" }),
    ];
    poolState.data = { registrations: waiting, assigned: new Map(), waiting };
    assignMock.mockResolvedValue({ status: "assigned", playerId: "p-1", via: "rpc" });
    const onAssigned = vi.fn();

    mount(
      <RegistrationPool
        sessionId="sess-1"
        target={{ kind: "group", groupId: "grp-1" }}
        currentPlayerNames={["Rohan"]}
        capacityRemaining={5}
        onAssigned={onAssigned}
      />,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("2 waiting");
    expect(text).toContain("Asha Mehta");
    expect(text).toContain("asha@example.com · Seat 1 · #1042");
    expect(text).toContain("Paid");
    expect(text).toContain("Name needed");
    expect(text).toContain("guest@example.com · Seat 2 · #1042");
    expect(text).toContain("Details pending");

    const addAsha = container.querySelector<HTMLButtonElement>('button[aria-label="Add Asha Mehta to roster"]');
    expect(addAsha).not.toBeNull();
    await act(async () => {
      addAsha!.click();
    });
    await flush();

    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(assignMock.mock.calls[0][0]).toMatchObject({
      sessionId: "sess-1",
      target: { kind: "group", groupId: "grp-1" },
      name: "Asha Mehta",
      registration: { id: "reg-a" },
    });
    expect(onAssigned).toHaveBeenCalled();
  });

  it("requires a typed roster name when none can be resolved", async () => {
    const waiting = [reg({ id: "reg-b", profile_id: null, profile: null, participant_name: null })];
    poolState.data = { registrations: waiting, assigned: new Map(), waiting };
    assignMock.mockResolvedValue({ status: "assigned", playerId: "p-2", via: "insert" });

    mount(
      <RegistrationPool sessionId="sess-1" target={{ kind: "court", courtId: 3 }} currentPlayerNames={[]} capacityRemaining={12} />,
    );

    const setName = container.querySelector<HTMLButtonElement>('button[aria-label="Set roster name and add"]');
    expect(setName).not.toBeNull();
    await act(async () => {
      setName!.click();
    });
    expect(assignMock).not.toHaveBeenCalled();

    const input = container.querySelector<HTMLInputElement>('input[aria-label="Roster name"]');
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Priya S");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input!.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(assignMock.mock.calls[0][0]).toMatchObject({ name: "Priya S", target: { kind: "court", courtId: 3 } });
  });

  it("blocks assignment for archived sessions and shows where assigned seats already play", () => {
    const rows = [reg({}), reg({ id: "reg-c", seat_index: 2, profile: { first_name: "Neel", last_name: null, email: null } })];
    const assigned = new Map([
      ["reg-c", { playerId: "p-9", name: "Neel", courtId: 2, groupId: null, unitLabel: "Court 2" }],
    ]);
    poolState.data = { registrations: rows, assigned, waiting: [rows[0]] };

    mount(
      <RegistrationPool
        sessionId="sess-1"
        target={{ kind: "court", courtId: 1 }}
        currentPlayerNames={[]}
        capacityRemaining={12}
        disabledReason="Archived sessions can't be changed."
      />,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Archived sessions can't be changed.");
    expect(text).toContain("On rosters (1)");
    const addAsha = container.querySelector<HTMLButtonElement>('button[aria-label="Add Asha Mehta to roster"]');
    expect(addAsha?.disabled).toBe(true);
  });

  it("summarises the session on the dashboard", () => {
    const rows = [reg({}), reg({ id: "reg-c", seat_index: 2, profile: { first_name: "Neel", last_name: null, email: null } })];
    poolState.data = {
      registrations: rows,
      assigned: new Map([["reg-c", { playerId: "p-9", name: "Neel", courtId: 2, groupId: null, unitLabel: "Court 2" }]]),
      waiting: [rows[0]],
    };
    mount(<RegistrationPoolSummary sessionId="sess-1" />);
    const text = container.textContent ?? "";
    expect(text).toContain("2 paid · 1 on rosters · 1 waiting");
    expect(text).toContain("Asha Mehta");
    expect(text).not.toContain("Neel");
  });
});

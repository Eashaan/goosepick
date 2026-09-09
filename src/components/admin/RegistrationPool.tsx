import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, ChevronDown, ChevronUp, Plus, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  REGISTRATION_POOL_QUERY_KEY,
  useRegistrationPool,
  useTerminalRosterAttention,
  type TerminalRosterAttentionRow,
} from "@/hooks/useRegistrationPool";
import { useEventCatalog } from "@/hooks/useEventCatalog";
import { CUSTOMER_SKILL_ADVISORY, customerSelectionChips } from "@/lib/customerSelection";
import {
  assignRegistrationToRoster,
  isDuplicateNameError,
  isDuplicateRegistrationError,
  isEndedSessionError,
  resolveContactEmail,
  resolveRosterName,
  type RegistrationPoolRow,
  type RosterTarget,
} from "@/lib/registrationAssignment";
import type { RegistrationStatus } from "@/integrations/supabase/participantDb";


const STATUS_LABEL: Partial<Record<RegistrationStatus, string>> = {
  paid: "Paid",
  profile_required: "Details pending",
  confirmed: "Confirmed",
};

const StatusBadge = ({ status }: { status: RegistrationStatus }) => (
  <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
    {STATUS_LABEL[status] ?? status}
  </span>
);

const seatLabel = (row: RegistrationPoolRow) => {
  const order = row.commerce_order?.shopify_order_name;
  return order ? `Seat ${row.seat_index} · ${order}` : `Seat ${row.seat_index}`;
};

/**
 * Read-only banner: a cancelled/refunded seat still has a roster player.
 * Nothing is ever changed automatically — no player removal, no rebalance, no
 * court/group/rotation/session mutation. A human reviews the placement.
 */
export const TerminalRosterAttention = ({ rows }: { rows: readonly TerminalRosterAttentionRow[] }) => {
  if (rows.length === 0) return null;
  return (
    <div
      className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
      data-testid="terminal-roster-attention"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        <p className="font-semibold text-foreground">
          {rows.length} refunded/cancelled participant{rows.length === 1 ? " is" : "s are"} still on a roster.
        </p>
      </div>
      <p className="mt-1 text-muted-foreground">
        Nothing was changed automatically — review placement manually.
      </p>
      <ul className="mt-2 space-y-1">
        {rows.map((row) => (
          <li key={row.registrationId} className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{row.playerName}</span>
            <span className="shrink-0 text-muted-foreground">
              {row.status === "refunded" ? "Refunded" : "Cancelled"} · {row.unitLabel}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};


interface RegistrationPoolProps {
  sessionId: string | null | undefined;
  target: RosterTarget;
  /** Names already on this roster — used to catch collisions before the DB does. */
  currentPlayerNames: string[];
  /** How many more players this roster can take. */
  capacityRemaining: number;
  /** When set, assignment is disabled and this reason is shown. */
  disabledReason?: string | null;
  /** Called after a successful assignment so the host page can refresh its players. */
  onAssigned?: () => void;
}

/**
 * Registration pool for ONE roster unit. Lives inside the existing Players card
 * on the court / group admin pages; manual player entry beside it is untouched.
 */
const RegistrationPool = ({
  sessionId,
  target,
  currentPlayerNames,
  capacityRemaining,
  disabledReason = null,
  onAssigned,
}: RegistrationPoolProps) => {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useRegistrationPool(sessionId);
  const { data: attention = [] } = useTerminalRosterAttention(sessionId);
  const { data: catalog } = useEventCatalog(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [assignedOpen, setAssignedOpen] = useState(false);


  const lowerNames = useMemo(
    () => new Set(currentPlayerNames.map((n) => n.trim().toLowerCase())),
    [currentPlayerNames],
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [REGISTRATION_POOL_QUERY_KEY, sessionId] });
    onAssigned?.();
  };

  const assign = useMutation({
    mutationFn: async ({ registration, name }: { registration: RegistrationPoolRow; name: string }) => {
      if (!sessionId) throw new Error("No active session for this roster.");
      return assignRegistrationToRoster({ registration, sessionId, target, name });
    },
    onSuccess: (result, vars) => {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[vars.registration.id];
        return next;
      });
      if (result.status === "already_assigned") {
        toast.info("That registration is already on a roster — list refreshed.");
      } else {
        toast.success(`${vars.name.trim()} added from registration`);
      }
      refresh();
    },
    onError: (err: Error, vars) => {
      if (isDuplicateRegistrationError(err)) {
        toast.info("That registration was just added by someone else — list refreshed.");
        refresh();
        return;
      }
      if (isDuplicateNameError(err) || /already exists on this roster/i.test(err.message)) {
        toast.error(`"${vars.name.trim()}" is already on this roster. Enter a different roster name.`);
        setDrafts((prev) => ({ ...prev, [vars.registration.id]: vars.name }));
        return;
      }
      if (isEndedSessionError(err)) {
        toast.error("Archived sessions can't be changed.");
        return;
      }
      toast.error(err.message || "Could not add this registration.");
    },
  });

  const handleAdd = (registration: RegistrationPoolRow) => {
    if (disabledReason) {
      toast.error(disabledReason);
      return;
    }
    if (capacityRemaining <= 0) {
      toast.error("This roster is full.");
      return;
    }
    const draft = drafts[registration.id];
    const name = (draft ?? resolveRosterName(registration) ?? "").trim();
    if (!name) {
      setDrafts((prev) => ({ ...prev, [registration.id]: "" }));
      toast.error("Enter a roster name for this registration first.");
      return;
    }
    if (draft === undefined && lowerNames.has(name.toLowerCase())) {
      setDrafts((prev) => ({ ...prev, [registration.id]: name }));
      toast.error(`"${name}" is already on this roster. Adjust the roster name, then add.`);
      return;
    }
    assign.mutate({ registration, name });
  };

  if (!sessionId) return null;
  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Checking online registrations...</p>;
  }
  if (isError || !data) {
    return <p className="text-xs text-muted-foreground">Online registrations are unavailable right now.</p>;
  }
  if (data.registrations.length === 0 && attention.length === 0) return null;

  const { waiting, assigned } = data;
  const assignedRows = data.registrations.filter((r) => assigned.has(r.id));

  return (
    <div className="rounded-lg border border-border bg-background/60 p-3 space-y-3" data-testid="registration-pool">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ticket className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Registered players</p>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {waiting.length} waiting
          </span>
        </div>
      </div>

      <TerminalRosterAttention rows={attention} />

      <p className="text-[11px] text-muted-foreground">{CUSTOMER_SKILL_ADVISORY}</p>

      {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}



      {waiting.length === 0 ? (
        <p className="text-xs text-muted-foreground">Every registration for this session is on a roster.</p>
      ) : (
        <div className="space-y-2">
          {waiting.map((registration) => {
            const resolved = resolveRosterName(registration);
            const draft = drafts[registration.id];
            const editing = draft !== undefined;
            const email = resolveContactEmail(registration);
            const pending = assign.isPending && assign.variables?.registration.id === registration.id;

            return (
              <div key={registration.id} className="rounded-lg bg-secondary p-3 space-y-2" data-registration-id={registration.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className={`truncate text-sm font-medium ${resolved ? "" : "italic text-muted-foreground"}`}>
                        {resolved ?? "Name needed"}
                      </p>
                      <StatusBadge status={registration.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {[email, seatLabel(registration)].filter(Boolean).join(" · ")}
                    </p>
                    {(() => {
                      const skill = customerSelectedSkill(registration, catalog?.products ?? []);
                      const chips = customerSelectionChips(registration, catalog?.products ?? []);
                      const visibleChips = chips.filter((c) => c !== skill);
                      if (!skill && visibleChips.length === 0) return null;
                      return (
                        <>
                          {skill && (
                            <p className="mt-1 text-[11px] text-muted-foreground" data-testid="customer-selected-skill">
                              Customer selected skill:{" "}
                              <span className="font-medium text-foreground">{skill}</span>
                            </p>
                          )}
                          {visibleChips.length > 0 && (
                            <p className="mt-1 text-[11px] text-muted-foreground" data-testid="customer-selected">
                              Customer selected: <span className="font-medium text-foreground">{visibleChips.join(" · ")}</span>
                            </p>
                          )}
                          {(registration.line_item_quantity ?? 1) > 1 && (
                            <p className="mt-1 text-[11px] text-muted-foreground" data-testid="multi-seat-skill-note">
                              {MULTI_SEAT_SKILL_NOTE}
                            </p>
                          )}
                        </>
                      );
                    })()}

                  </div>

                  {!editing && (
                    <Button
                      size="sm"
                      className="h-8 shrink-0"
                      onClick={() => handleAdd(registration)}
                      disabled={Boolean(disabledReason) || capacityRemaining <= 0 || pending}
                      aria-label={resolved ? `Add ${resolved} to roster` : "Set roster name and add"}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      {pending ? "Adding..." : resolved ? "Add" : "Set name"}
                    </Button>
                  )}
                </div>

                {editing && (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleAdd(registration);
                    }}
                  >
                    <Input
                      value={draft}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [registration.id]: e.target.value }))}
                      placeholder="Roster name"
                      className="h-8 flex-1 bg-background text-sm"
                      autoFocus
                      aria-label="Roster name"
                    />
                    <Button type="submit" size="sm" className="h-8" disabled={!draft.trim() || pending}>
                      <Check className="mr-1 h-3.5 w-3.5" /> Add
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() =>
                        setDrafts((prev) => {
                          const next = { ...prev };
                          delete next[registration.id];
                          return next;
                        })
                      }
                    >
                      Cancel
                    </Button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}

      {assignedRows.length > 0 && (
        <Collapsible open={assignedOpen} onOpenChange={setAssignedOpen}>
          <CollapsibleTrigger className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground">
            <span>On rosters ({assignedRows.length})</span>
            {assignedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1">
            {assignedRows.map((registration) => {
              const info = assigned.get(registration.id)!;
              const here =
                (target.kind === "court" && info.courtId === target.courtId && !info.groupId) ||
                (target.kind === "group" && info.groupId === target.groupId);
              return (
                <div key={registration.id} className="flex items-center justify-between text-xs">
                  <span className="truncate">{info.name}</span>
                  <span className={`ml-2 shrink-0 ${here ? "text-primary" : "text-muted-foreground"}`}>
                    {here ? "On this roster" : info.unitLabel}
                  </span>
                </div>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
};

export default RegistrationPool;

/** Compact session-wide registration status for the admin dashboard. */
export const RegistrationPoolSummary = ({ sessionId }: { sessionId: string | null | undefined }) => {
  const { data, isLoading, isError } = useRegistrationPool(sessionId);
  const { data: attention = [] } = useTerminalRosterAttention(sessionId);
  if (!sessionId || isLoading || isError || !data) return null;

  const total = data.registrations.length;
  const onRosters = data.assigned.size;
  const waiting = data.waiting;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="registration-summary">

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Ticket className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Online registrations</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {total === 0
            ? "None linked to this session yet"
            : `${total} paid · ${onRosters} on rosters · ${waiting.length} waiting`}
        </p>
      </div>
      <TerminalRosterAttention rows={attention} />
      {waiting.length > 0 && (
        <>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {waiting.map((r) => {
              const name = resolveRosterName(r);
              return (
                <span
                  key={r.id}
                  className={`rounded-full px-2.5 py-1 text-xs ${name ? "bg-secondary text-foreground" : "bg-secondary italic text-muted-foreground"}`}
                >
                  {name ?? `Name needed · seat ${r.seat_index}`}
                </span>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Open a court or group below to add waiting players to its roster.
          </p>
        </>
      )}
    </div>
  );
};

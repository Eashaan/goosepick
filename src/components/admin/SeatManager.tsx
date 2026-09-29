import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Armchair, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { REGISTRATION_POOL_QUERY_KEY, useRegistrationPool } from "@/hooks/useRegistrationPool";
import { resolveRosterName, type RegistrationPoolRow } from "@/lib/registrationAssignment";
import {
  MANUAL_SEAT_SOURCES,
  SEAT_SOURCE_LABEL,
  summarizeSeats,
  type ManualSeatSource,
} from "@/lib/seatLedger";

interface SeatManagerProps {
  sessionId: string | null | undefined;
  isEnded?: boolean;
}

interface SeatForm {
  id?: string;
  source: string;
  name: string;
  email: string;
  phone: string;
  skill: string;
  note: string;
}

const EMPTY_FORM: SeatForm = { source: "offline_paid", name: "", email: "", phone: "", skill: "", note: "" };

type RpcResult = { ok: boolean; message?: string; conflict?: boolean; over_capacity?: boolean };

// The new RPCs are not yet in the generated types.
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);

const SeatManager = ({ sessionId, isEnded = false }: SeatManagerProps) => {
  const queryClient = useQueryClient();
  const { data: pool } = useRegistrationPool(sessionId);
  const { data: session } = useQuery({
    queryKey: ["seat-manager-session", sessionId],
    enabled: Boolean(sessionId),
    queryFn: async () => {
      const { data } = await supabase
        .from("sessions")
        .select("id, capacity, event_type")
        .eq("id", sessionId!)
        .maybeSingle();
      return data;
    },
  });
  const [form, setForm] = useState<SeatForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOver, setConfirmOver] = useState(false);

  if (!sessionId) return null;
  const rows = pool?.registrations ?? [];
  const summary = summarizeSeats(rows, session?.capacity ?? null);
  const isThursdays = session?.event_type === "thursdays";

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [REGISTRATION_POOL_QUERY_KEY, sessionId] });
  };

  const openEdit = (r: RegistrationPoolRow) =>
    setForm({
      id: r.id,
      source: r.seat_source ?? "shopify",
      name: r.participant_name ?? "",
      email: r.participant_email ?? "",
      phone: r.participant_phone ?? "",
      skill: r.selected_skill_level ?? "",
      note: r.admin_note ?? "",
    });

  const save = async (allowOver = false) => {
    if (!form) return;
    const isShopify = form.source === "shopify";
    if (!isShopify && !form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setBusy(true);
    const { data, error } = form.id
      ? await rpc("admin_update_seat", {
          p_registration_id: form.id,
          p_name: form.name,
          p_email: form.email,
          p_phone: form.phone,
          p_skill: form.skill,
          p_note: form.note,
          p_source: isShopify ? null : form.source,
        })
      : await rpc("admin_add_manual_seat", {
          p_session_id: sessionId,
          p_source: form.source,
          p_name: form.name,
          p_email: form.email,
          p_phone: form.phone,
          p_skill: isThursdays ? form.skill : null,
          p_note: form.note,
          p_allow_over_capacity: allowOver,
        });
    setBusy(false);
    const result = data as RpcResult | null;
    if (error || !result?.ok) {
      if (result?.conflict) {
        setConfirmOver(true);
        return;
      }
      toast.error(error?.message ?? result?.message ?? "Could not save seat");
      return;
    }
    toast.success(form.id ? "Seat updated" : result.over_capacity ? "Seat added — over capacity" : "Seat added");
    setConfirmOver(false);
    setForm(null);
    refresh();
  };

  const cancelSeat = async (r: RegistrationPoolRow) => {
    if (!window.confirm(`Remove ${resolveRosterName(r) ?? "this seat"}? This frees one seat.`)) return;
    const { data, error } = await rpc("admin_cancel_manual_seat", { p_registration_id: r.id });
    const result = data as RpcResult | null;
    if (error || !result?.ok) {
      toast.error(error?.message ?? result?.message ?? "Could not remove seat");
      return;
    }
    toast.success("Seat removed");
    refresh();
  };

  const field = (key: keyof SeatForm, label: string, props: Record<string, unknown> = {}) => (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        value={(form?.[key] as string) ?? ""}
        onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
        {...props}
      />
    </label>
  );

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3" data-testid="seat-manager">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Armchair className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Seats</p>
        </div>
        {!isEnded && (
          <Button size="sm" variant="outline" onClick={() => setForm({ ...EMPTY_FORM })}>
            <Plus className="mr-1 h-4 w-4" /> Add seat
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className={summary.overCapacity ? "font-semibold text-destructive" : "text-foreground"}>
          Occupied {summary.occupied} / {summary.capacity ?? "No cap"}
        </span>
        {summary.capacity != null && (
          <span className="text-muted-foreground">
            {summary.overCapacity ? `Over capacity by ${summary.occupied - summary.capacity}` : `Available ${summary.available}`}
          </span>
        )}
        <span className="text-muted-foreground">
          {Object.entries(summary.bySource)
            .map(([s, n]) => `${SEAT_SOURCE_LABEL[s] ?? s} ${n}`)
            .join(" · ") || "No seats yet"}
        </span>
      </div>

      {rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const source = r.seat_source ?? "shopify";
            const placed = pool?.assigned.get(r.id);
            return (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{resolveRosterName(r) ?? `Name needed · seat ${r.seat_index}`}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {SEAT_SOURCE_LABEL[source] ?? source}
                    {source === "shopify" && r.commerce_order?.shopify_order_name ? ` · ${r.commerce_order.shopify_order_name}` : ""}
                    {source === "shopify" && r.seat_index > 1 ? ` · Guest seat` : ""}
                    {r.selected_skill_level ? ` · ${r.selected_skill_level}` : ""}
                    {` · ${placed ? placed.unitLabel : "Unassigned"}`}
                  </p>
                </div>
                {!isEnded && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" aria-label="Edit seat" onClick={() => openEdit(r)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {source !== "shopify" && (
                      <Button size="icon" variant="ghost" aria-label="Remove seat" onClick={() => cancelSeat(r)}>
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={Boolean(form)} onOpenChange={(open) => !open && (setForm(null), setConfirmOver(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit seat" : "Add seat"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              {form.source !== "shopify" ? (
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">Seat type</span>
                  <select
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.source}
                    onChange={(e) => setForm({ ...form, source: e.target.value as ManualSeatSource })}
                  >
                    {MANUAL_SEAT_SOURCES.map((s) => (
                      <option key={s} value={s}>{SEAT_SOURCE_LABEL[s]}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Shopify seat — only name, contact, skill and note can be changed here.
                </p>
              )}
              {field("name", form.source === "shopify" ? "Name (blank keeps the default label)" : "Name *")}
              {field("phone", "Phone (optional)", { inputMode: "tel" })}
              {field("email", "Email (optional)", { type: "email" })}
              {isThursdays && field("skill", "Skill level (optional)")}
              {field("note", "Admin note (optional)")}
              {confirmOver && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  This session is at capacity. Adding this seat will put it over capacity.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            {confirmOver ? (
              <Button variant="destructive" disabled={busy} onClick={() => save(true)}>
                Add anyway (over capacity)
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => save(false)}>
                {busy ? "Saving..." : "Save"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SeatManager;

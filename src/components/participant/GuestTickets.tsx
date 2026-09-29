import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { guestSeatLabel } from "@/lib/registrationAssignment";
import type { ExperienceRegistrationRow } from "@/integrations/supabase/participantDb";

interface Props {
  guests: ExperienceRegistrationRow[];
  purchaserName: string | null;
}

/** Purchaser's unclaimed guest seats; names are editable via a scoped RPC. */
const GuestTickets = ({ guests, purchaserName }: Props) => {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  if (guests.length === 0) return null;

  const save = async (id: string) => {
    const { data, error } = await (supabase.rpc as unknown as (
      f: string,
      a: Record<string, unknown>,
    ) => Promise<{ data: { ok: boolean; message?: string } | null; error: { message: string } | null }>)(
      "participant_update_guest_seat",
      { p_registration_id: id, p_name: name, p_phone: phone || null },
    );
    if (error || !data?.ok) {
      toast.error(error?.message ?? data?.message ?? "Could not save");
      return;
    }
    toast.success("Guest updated");
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <p className="text-sm font-semibold text-foreground">Your guests: {guests.length}</p>
      {guests.map((g) => (
        <div key={g.id} className="space-y-2">
          {editing === g.id ? (
            <div className="space-y-2">
              <Input placeholder="Guest name" value={name} onChange={(e) => setName(e.target.value)} />
              <Input placeholder="Phone (optional)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" disabled={!name.trim()} onClick={() => save(g.id)}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">
                {g.participant_name?.trim() || guestSeatLabel(purchaserName, g.seat_index)}
              </span>
              <button
                className="text-xs font-medium text-primary underline underline-offset-4"
                onClick={() => {
                  setEditing(g.id);
                  setName(g.participant_name ?? "");
                  setPhone("");
                }}
              >
                Edit
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default GuestTickets;

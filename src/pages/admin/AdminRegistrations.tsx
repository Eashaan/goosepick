import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { participantDb } from "@/integrations/supabase/participantDb";
import { Database } from "@/integrations/supabase/types";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useActiveSession } from "@/hooks/useActiveSession";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import AdminContextBanner from "@/components/admin/AdminContextBanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Registration = Database["public"]["Tables"]["experience_registrations"]["Row"];
type Profile = Database["public"]["Tables"]["participant_profiles"]["Row"];
type CourtUnit = Database["public"]["Tables"]["court_units"]["Row"];

type PoolRow = Registration & {
  profile?: Profile;
  purchaserEmail?: string | null;
};

const AdminRegistrations = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, isLoading: authLoading } = useAdminAuth();
  const { activeSession, sessionId } = useActiveSession();
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!authLoading && !isAdmin) navigate("/admin/login", { replace: true });
  }, [authLoading, isAdmin, navigate]);

  const { data: registrations = [], isLoading } = useQuery({
    queryKey: ["admin-registration-pool", sessionId],
    enabled: Boolean(isAdmin && sessionId),
    queryFn: async (): Promise<PoolRow[]> => {
      const { data: rows, error } = await supabase
        .from("experience_registrations")
        .select("*")
        .eq("session_id", sessionId!)
        .in("status", ["paid", "profile_required", "confirmed"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      if (!rows?.length) return [];

      const registrationIds = rows.map((row) => row.id);
      const profileIds = [...new Set(rows.map((row) => row.profile_id).filter((id): id is string => Boolean(id)))];
      const orderIds = [...new Set(rows.map((row) => row.commerce_order_id).filter((id): id is string => Boolean(id)))];

      const [{ data: linkedPlayers }, profilesResult, ordersResult] = await Promise.all([
        supabase.from("players").select("registration_id").in("registration_id", registrationIds),
        profileIds.length
          ? supabase.from("participant_profiles").select("*").in("id", profileIds)
          : Promise.resolve({ data: [] as Profile[], error: null }),
        orderIds.length
          ? supabase.from("commerce_orders").select("id, purchaser_email").in("id", orderIds)
          : Promise.resolve({ data: [] as { id: string; purchaser_email: string | null }[], error: null }),
      ]);

      if (profilesResult.error) throw profilesResult.error;
      if (ordersResult.error) throw ordersResult.error;

      const assigned = new Set((linkedPlayers ?? []).map((player) => player.registration_id).filter(Boolean));
      const profileMap = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
      const orderMap = new Map((ordersResult.data ?? []).map((order) => [order.id, order.purchaser_email]));

      return rows
        .filter((row) => !assigned.has(row.id))
        .map((row) => ({
          ...row,
          profile: row.profile_id ? profileMap.get(row.profile_id) : undefined,
          purchaserEmail: row.commerce_order_id ? orderMap.get(row.commerce_order_id) : null,
        }));
    },
  });

  const { data: courtUnits = [] } = useQuery({
    queryKey: ["registration-roster-targets", sessionId],
    enabled: Boolean(isAdmin && sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("court_units")
        .select("*")
        .eq("session_id", sessionId!)
        .order("display_name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const targetsAvailable = useMemo(
    () => courtUnits.filter((unit) =>
      (unit.type === "court" && unit.court_id != null) ||
      (unit.type === "group" && unit.court_group_id != null),
    ),
    [courtUnits],
  );

  const assignRegistration = useMutation({
    mutationFn: async ({ registration, targetValue, rosterName }: { registration: PoolRow; targetValue: string; rosterName: string }) => {
      const [kind, id] = targetValue.split(":");
      if (!id || !["court", "group"].includes(kind)) throw new Error("Choose a valid court or group");
      if (!rosterName.trim()) throw new Error("Enter the player's roster name");

      // This RPC is authored in db/phase2_registration_assignment.sql and is
      // intentionally review-only until that SQL is approved/applied.
      const { error } = await participantDb.rpc("assign_registration_to_roster", {
        p_registration_id: registration.id,
        p_roster_name: rosterName.trim(),
        p_court_id: kind === "court" ? Number(id) : null,
        p_group_id: kind === "group" ? id : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-registration-pool", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["players"] });
      queryClient.invalidateQueries({ queryKey: ["group_players"] });
      toast.success("Registration added to roster");
    },
    onError: (error: Error) => {
      const message = error.message.toLowerCase();
      if (message.includes("already assigned") || message.includes("duplicate")) {
        toast.error("That registration is already on a roster");
      } else if (message.includes("ended")) {
        toast.error("Ended sessions cannot be changed");
      } else if (message.includes("function") && message.includes("assign_registration_to_roster")) {
        toast.error("Registration assignment helper has not been enabled yet");
      } else {
        toast.error(error.message || "Could not assign registration");
      }
    },
  });

  if (authLoading || !isAdmin) return null;

  const isEnded = activeSession?.status === "ended";

  return (
    <PageLayout>
      <GlobalHeader />
      <AdminContextBanner />
      <div className="mx-auto min-h-screen w-full max-w-2xl px-6 py-8">
        <div className="mb-6 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link to="/admin"><ChevronLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">Registrations</h1>
            <p className="text-sm text-muted-foreground">Paid seats waiting to be placed into the existing roster.</p>
          </div>
        </div>

        {!sessionId ? (
          <EmptyState title="No current session" body="Create or select the session setup before assigning registrations." />
        ) : isEnded ? (
          <EmptyState title="Session ended" body="Registrations are read-only after a session has ended." />
        ) : isLoading ? (
          <p className="py-10 text-center text-muted-foreground">Loading registrations...</p>
        ) : registrations.length === 0 ? (
          <EmptyState title="No unassigned registrations" body="Paid registrations for this session will appear here automatically." />
        ) : (
          <div className="space-y-4">
            {registrations.map((registration) => {
              const profileName = registration.profile
                ? [registration.profile.first_name, registration.profile.last_name].filter(Boolean).join(" ").trim()
                : "";
              const suggestedName = profileName || registration.participant_name?.trim() || "";
              const rosterName = names[registration.id] ?? suggestedName;
              const email = registration.participant_email || registration.profile?.email || registration.purchaserEmail;
              const target = targets[registration.id] || "";

              return (
                <div key={registration.id} className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">{suggestedName || "Unnamed participant"}</p>
                      {email && <p className="mt-1 text-sm text-muted-foreground">{email}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">Seat {registration.seat_index} · {registration.status.replace("_", " ")}</p>
                    </div>
                    <Users className="h-5 w-5 text-muted-foreground" />
                  </div>

                  <div className="mt-4 space-y-3">
                    <Input
                      value={rosterName}
                      onChange={(event) => setNames((current) => ({ ...current, [registration.id]: event.target.value }))}
                      placeholder="Roster name"
                      aria-label="Roster name"
                    />
                    <Select value={target} onValueChange={(value) => setTargets((current) => ({ ...current, [registration.id]: value }))}>
                      <SelectTrigger><SelectValue placeholder="Assign to court / group" /></SelectTrigger>
                      <SelectContent>
                        {targetsAvailable.map((unit: CourtUnit) => {
                          const value = unit.type === "group" ? `group:${unit.court_group_id}` : `court:${unit.court_id}`;
                          return <SelectItem key={unit.id} value={value}>{unit.display_name}</SelectItem>;
                        })}
                      </SelectContent>
                    </Select>
                    <Button
                      className="w-full"
                      disabled={!target || !rosterName.trim() || assignRegistration.isPending}
                      onClick={() => assignRegistration.mutate({ registration, targetValue: target, rosterName })}
                    >
                      Add to roster
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
};

const EmptyState = ({ title, body }: { title: string; body: string }) => (
  <div className="rounded-2xl border border-border bg-card p-8 text-center">
    <p className="font-semibold">{title}</p>
    <p className="mt-2 text-sm text-muted-foreground">{body}</p>
  </div>
);

export default AdminRegistrations;

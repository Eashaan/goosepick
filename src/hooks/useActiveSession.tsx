import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEventContext } from "@/hooks/useEventContext";
import { toast } from "sonner";

export type SessionStatus = "draft" | "live" | "ended";

export interface ActiveSession {
  id: string;
  city_id: string;
  event_type: string;
  location_id: string | null;
  status: SessionStatus;
  started_at: string | null;
  ended_at: string | null;
  session_label: string | null;
  date: string;
  created_at: string;
}

export function useActiveSession() {
  const queryClient = useQueryClient();
  const {
    selectedCityId,
    selectedLocationId,
    scopeEventType,
    isContextValid,
    selectedCity,
    selectedEvent,
    selectedLocation,
  } = useEventContext();

  const scopeKey = [selectedCityId, scopeEventType, selectedLocationId];

  // Resolve the current working session for this scope.
  // Order matters: live first, then draft. An ended session is historical and must
  // never displace a newer draft or be silently revived for a new event run.
  const { data: activeSession, isLoading: sessionLoading } = useQuery({
    queryKey: ["active_session", ...scopeKey],
    queryFn: async () => {
      let liveQuery = supabase
        .from("sessions" as any)
        .select("*")
        .eq("city_id", selectedCityId)
        .eq("event_type", scopeEventType!)
        .eq("status", "live");
      if (selectedLocationId) {
        liveQuery = liveQuery.eq("location_id", selectedLocationId);
      } else {
        liveQuery = liveQuery.is("location_id", null);
      }
      const { data: liveData, error: liveError } = await (liveQuery as any).maybeSingle();
      if (liveError) throw liveError;
      if (liveData) return liveData as ActiveSession;

      let draftQuery = supabase
        .from("sessions" as any)
        .select("*")
        .eq("city_id", selectedCityId)
        .eq("event_type", scopeEventType!)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(1);
      if (selectedLocationId) {
        draftQuery = draftQuery.eq("location_id", selectedLocationId);
      } else {
        draftQuery = draftQuery.is("location_id", null);
      }
      const { data: draftData, error: draftError } = await (draftQuery as any);
      if (draftError) throw draftError;
      if (draftData && draftData.length > 0) return draftData[0] as ActiveSession;

      // Historical fallback is useful for archive/export UI only when there is no
      // current live or draft session. startSession() will create a NEW session id.
      let endedQuery = supabase
        .from("sessions" as any)
        .select("*")
        .eq("city_id", selectedCityId)
        .eq("event_type", scopeEventType!)
        .eq("status", "ended")
        .order("ended_at", { ascending: false })
        .limit(1);
      if (selectedLocationId) {
        endedQuery = endedQuery.eq("location_id", selectedLocationId);
      } else {
        endedQuery = endedQuery.is("location_id", null);
      }
      const { data: endedData, error: endedError } = await (endedQuery as any);
      if (endedError) throw endedError;
      if (endedData && endedData.length > 0) return endedData[0] as ActiveSession;

      return null;
    },
    enabled: isContextValid && !!scopeEventType,
    refetchInterval: 10_000,
  });

  const invalidateSession = () => {
    queryClient.invalidateQueries({ queryKey: ["active_session"] });
  };

  const buildLabel = () => {
    const today = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const parts = [
      selectedEvent?.name || "Session",
      selectedCity?.name || "",
      selectedLocation?.name || "",
    ].filter(Boolean);
    return `${parts.join(" ")} — ${today}`;
  };

  // Start Session: promote a draft, otherwise create a brand-new session.
  // ENDED sessions are immutable history and are never revived.
  const startSession = useMutation({
    mutationFn: async () => {
      let check = supabase
        .from("sessions" as any)
        .select("id")
        .eq("city_id", selectedCityId)
        .eq("event_type", scopeEventType!)
        .eq("status", "live");
      if (selectedLocationId) {
        check = check.eq("location_id", selectedLocationId);
      } else {
        check = check.is("location_id", null);
      }
      const { data: existing, error: checkError } = await (check as any).maybeSingle();
      if (checkError) throw checkError;
      if (existing) throw new Error("A session is already live for this location.");

      if (activeSession?.status === "draft") {
        const { error } = await supabase
          .from("sessions" as any)
          .update({
            status: "live",
            started_at: new Date().toISOString(),
            session_label: buildLabel(),
            is_active: true,
          } as any)
          .eq("id", activeSession.id);
        if (error) throw error;
        return activeSession.id;
      }

      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("sessions" as any)
        .insert({
          city_id: selectedCityId,
          event_type: scopeEventType,
          location_id: selectedLocationId,
          date: today,
          is_active: true,
          status: "live",
          started_at: new Date().toISOString(),
          session_label: buildLabel(),
        } as any)
        .select("id")
        .single();
      if (error) throw error;

      // Link the current scope configuration to the new run.
      let configQuery = supabase
        .from("session_configs" as any)
        .select("id")
        .eq("city_id", selectedCityId)
        .eq("event_type", scopeEventType!);
      if (selectedLocationId) {
        configQuery = configQuery.eq("location_id", selectedLocationId);
      } else {
        configQuery = configQuery.is("location_id", null);
      }
      const { data: config, error: configError } = await (configQuery as any).maybeSingle();
      if (configError) throw configError;
      if (config) {
        const { error: linkError } = await supabase
          .from("session_configs" as any)
          .update({ session_id: (data as any).id } as any)
          .eq("id", (config as any).id);
        if (linkError) throw linkError;
      }

      return (data as any).id;
    },
    onSuccess: (sessionId) => {
      localStorage.setItem("gp_session_id", sessionId);
      invalidateSession();
      toast.success("Session started — scoring is now live.");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const newSession = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("sessions" as any)
        .insert({
          city_id: selectedCityId,
          event_type: scopeEventType,
          location_id: selectedLocationId,
          date: today,
          is_active: false,
          status: "draft",
          session_label: null,
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      return (data as any).id as string;
    },
    onSuccess: (sessionId) => {
      localStorage.setItem("gp_session_id", sessionId);
      invalidateSession();
      queryClient.invalidateQueries({ queryKey: ["session_config"] });
      queryClient.invalidateQueries({ queryKey: ["court_units"] });
      toast.success("New session created. Configure the courts for this run.");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const endSession = useMutation({
    mutationFn: async () => {
      if (!activeSession || activeSession.status !== "live") {
        throw new Error("No live session to end.");
      }
      const { error } = await supabase
        .from("sessions" as any)
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
          is_active: false,
        } as any)
        .eq("id", activeSession.id);
      if (error) throw error;
    },
    onSuccess: () => {
      localStorage.removeItem("gp_session_id");
      invalidateSession();
      toast.success("Session ended. Data is archived.");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Reset Session is destructive for the current working session only.
  const resetSession = useMutation({
    mutationFn: async () => {
      if (!activeSession?.id) throw new Error("No active session to reset.");
      const { data, error } = await supabase.functions.invoke("reset-session", {
        body: {
          sessionId: activeSession.id,
          cityId: selectedCityId,
          eventType: scopeEventType,
          locationId: selectedLocationId || null,
        },
      });
      if (error) throw new Error(error.message || "Network error");
      if (!data?.ok) throw new Error(data?.message || "Reset failed");
      return data;
    },
    onSuccess: () => {
      invalidateSession();
      queryClient.invalidateQueries({ queryKey: ["session_config"] });
      queryClient.invalidateQueries({ queryKey: ["court_units"] });
      queryClient.invalidateQueries({ queryKey: ["court_groups"] });
      queryClient.invalidateQueries({ queryKey: ["group_matches"] });
      queryClient.invalidateQueries({ queryKey: ["group_players"] });
      queryClient.invalidateQueries({ queryKey: ["group_court_state"] });
      queryClient.invalidateQueries({ queryKey: ["court_states_dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["court_match_counts"] });
      queryClient.invalidateQueries({ queryKey: ["group_status_dashboard"] });
      toast.success("Session reset. Setup wizard is ready for a fresh configuration.");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return {
    activeSession,
    sessionLoading,
    sessionId: activeSession?.id || null,
    sessionStatus: (activeSession?.status as SessionStatus) || null,
    isLive: activeSession?.status === "live",
    isEnded: activeSession?.status === "ended",
    isDraft: activeSession?.status === "draft",
    startSession,
    newSession,
    endSession,
    resetSession,
    invalidateSession,
  };
}

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
    selectedEventId,
    selectedLocationId,
    scopeEventType,
    isContextValid,
    selectedCity,
    selectedEvent,
    selectedLocation,
  } = useEventContext();

  const scopeKey = [selectedCityId, scopeEventType, selectedLocationId];

  // Fetch the live session (or latest draft/ended)
  const { data: activeSession, isLoading: sessionLoading } = useQuery({
    queryKey: ["active_session", ...scopeKey],
    queryFn: async () => {
      // Try live first
      let query = supabase
        .from("sessions" as any)
        .select("*")
        .eq("city_id", selectedCityId)
        .eq("event_type", scopeEventType!)
        .eq("status", "live");
      if (selectedLocationId) {
        query = query.eq("location_id", selectedLocationId);
      } else {
        query = query.is("location_id", null);
      }
      const { data: liveData } = await (query as any).maybeSingle();
      if (liveData) return liveData as ActiveSession;

      // Fallback: latest ended (prioritized so Export CSV is available)
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
      const { data: endedData } = await (endedQuery as any);
      if (endedData && endedData.length > 0) return endedData[0] as ActiveSession;

      // Fallback: latest draft
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
      const { data: draftData } = await (draftQuery as any);
      if (draftData && draftData.length > 0) return draftData[0] as ActiveSession;

      return null;
    },
    enabled: isContextValid && !!scopeEventType,
    refetchInterval: 10_000,
  });

  const invalidateSession = () => {
    queryClient.invalidateQueries({ queryKey: ["active_session"] });
  };

  // Build a session label
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

  // Start Session: create new live session (or promote draft)
  const startSession = useMutation({
    mutationFn: async () => {
      // Check no live session exists
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
      const { data: existing } = await (check as any).maybeSingle();
      if (existing) throw new Error("A session is already live for this location.");

      if (activeSession?.status === "draft") {
        // Promote draft to live
        const { error } = await supabase
          .from("sessions" as any)
          .update({
            status: "live",
            started_at: new Date().toISOString(),
            session_label: buildLabel(),
          } as any)
          .eq("id", activeSession.id);
        if (error) throw error;
      return activeSession.id;
    }

    // Promote ended session back to live (same-day restart)
    if (activeSession?.status === "ended") {
      const { error } = await supabase
        .from("sessions" as any)
        .update({
          status: "live",
          started_at: new Date().toISOString(),
          ended_at: null,
          is_active: true,
          session_label: buildLabel(),
        } as any)
        .eq("id", activeSession.id);
      if (error) throw error;
      return activeSession.id;
      }

      // Create new live session
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

      // Link session to session_config
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
      const { data: config } = await (configQuery as any).maybeSingle();
      if (config) {
        await supabase
          .from("session_configs" as any)
          .update({ session_id: (data as any).id } as any)
          .eq("id", (config as any).id);
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

  // End Session
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
      invalidateSession();
      toast.success("Session ended. Data is archived.");
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // Reset Session — wipes all data and resets to fresh state
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
    endSession,
    resetSession,
    invalidateSession,
  };
}

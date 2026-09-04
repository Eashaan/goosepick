import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEventContext } from "./useEventContext";
import { useActiveSession } from "./useActiveSession";

/**
 * Validates that a court belongs to the current event/location context.
 * Redirects to home if context is invalid or court doesn't belong.
 */
export const useCourtContextGuard = (courtId: number) => {
  const navigate = useNavigate();
  const {
    selectedEventId,
    selectedLocationId,
    requiresLocation,
    isLoading: contextLoading,
    isContextValid,
  } = useEventContext();
  const { sessionId: activeSessionId, sessionLoading } = useActiveSession();

  // Fetch court to validate it belongs to current context and active run
  const { data: court, isLoading: courtLoading } = useQuery({
    queryKey: ["court_context_check", courtId, activeSessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courts")
        .select("id, event_id, location_id, session_id")
        .eq("id", courtId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [validated, setValidated] = useState(false);

  useEffect(() => {
    if (contextLoading || courtLoading || sessionLoading) return;

    // No context selected → go home
    if (!isContextValid) {
      navigate("/", { replace: true });
      return;
    }

    // Court doesn't exist
    if (!court) {
      navigate("/", { replace: true });
      return;
    }

    // Court must belong to the active session, not just the same event/location.
    if (activeSessionId && court.session_id !== activeSessionId) {
      navigate("/", { replace: true });
      return;
    }

    // Court doesn't belong to selected event
    if (court.event_id !== selectedEventId) {
      navigate("/", { replace: true });
      return;
    }

    // For recurring events, court must belong to selected location
    if (requiresLocation && court.location_id !== selectedLocationId) {
      navigate("/", { replace: true });
      return;
    }

    // For non-recurring events, court's location should be null
    if (!requiresLocation && court.location_id !== null) {
      navigate("/", { replace: true });
      return;
    }

    setValidated(true);
  }, [contextLoading, courtLoading, sessionLoading, activeSessionId, court, selectedEventId, selectedLocationId, requiresLocation, isContextValid, navigate]);

  return { isValidating: contextLoading || courtLoading || sessionLoading || !validated };
};

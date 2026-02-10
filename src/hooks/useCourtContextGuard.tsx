import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEventContext } from "./useEventContext";

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

  // Fetch court to validate it belongs to current context
  const { data: court, isLoading: courtLoading } = useQuery({
    queryKey: ["court_context_check", courtId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courts")
        .select("id, event_id, location_id")
        .eq("id", courtId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [validated, setValidated] = useState(false);

  useEffect(() => {
    if (contextLoading || courtLoading) return;

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
  }, [contextLoading, courtLoading, court, selectedEventId, selectedLocationId, requiresLocation, isContextValid, navigate]);

  return { isValidating: contextLoading || courtLoading || !validated };
};

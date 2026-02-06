import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Known event IDs from seed data
export const GOOSEPICK_SOCIAL_ID = "11111111-1111-1111-1111-111111111111";
export const GOOSEPICK_THURSDAYS_ID = "22222222-2222-2222-2222-222222222222";

interface Event {
  id: string;
  name: string;
  event_type: "one_off" | "recurring";
  active: boolean;
}

interface Location {
  id: string;
  event_id: string;
  name: string;
  active: boolean;
}

interface EventContextType {
  events: Event[];
  locations: Location[];
  selectedEventId: string | null;
  selectedLocationId: string | null;
  setSelectedEventId: (id: string | null) => void;
  setSelectedLocationId: (id: string | null) => void;
  selectedEvent: Event | null;
  selectedLocation: Location | null;
  requiresLocation: boolean;
  isLoading: boolean;
  clearSelection: () => void;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

export const EventProvider = ({ children }: { children: ReactNode }) => {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  // Fetch events
  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["events"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as Event[];
    },
  });

  // Fetch locations
  const { data: locations = [], isLoading: locationsLoading } = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as Location[];
    },
  });

  const selectedEvent = events.find((e) => e.id === selectedEventId) || null;
  const selectedLocation = locations.find((l) => l.id === selectedLocationId) || null;
  
  // Recurring events require location selection
  const requiresLocation = selectedEvent?.event_type === "recurring";

  // Clear location when event changes
  useEffect(() => {
    if (selectedEventId && !requiresLocation) {
      setSelectedLocationId(null);
    }
  }, [selectedEventId, requiresLocation]);

  const clearSelection = () => {
    setSelectedEventId(null);
    setSelectedLocationId(null);
  };

  return (
    <EventContext.Provider
      value={{
        events,
        locations,
        selectedEventId,
        selectedLocationId,
        setSelectedEventId,
        setSelectedLocationId,
        selectedEvent,
        selectedLocation,
        requiresLocation,
        isLoading: eventsLoading || locationsLoading,
        clearSelection,
      }}
    >
      {children}
    </EventContext.Provider>
  );
};

export const useEventContext = () => {
  const context = useContext(EventContext);
  if (context === undefined) {
    throw new Error("useEventContext must be used within an EventProvider");
  }
  return context;
};

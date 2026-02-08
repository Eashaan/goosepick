import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Known event IDs from seed data
export const GOOSEPICK_SOCIAL_ID = "11111111-1111-1111-1111-111111111111";
export const GOOSEPICK_THURSDAYS_ID = "22222222-2222-2222-2222-222222222222";
export const MUMBAI_CITY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

interface City {
  id: string;
  name: string;
  active: boolean;
}

interface Event {
  id: string;
  name: string;
  event_type: "one_off" | "recurring";
  active: boolean;
  city_id: string | null;
}

interface Location {
  id: string;
  event_id: string;
  name: string;
  active: boolean;
  city_id: string | null;
}

interface EventContextType {
  cities: City[];
  events: Event[];
  locations: Location[];
  selectedCityId: string;
  selectedEventId: string | null;
  selectedLocationId: string | null;
  setSelectedCityId: (id: string) => void;
  setSelectedEventId: (id: string | null) => void;
  setSelectedLocationId: (id: string | null) => void;
  selectedCity: City | null;
  selectedEvent: Event | null;
  selectedLocation: Location | null;
  requiresLocation: boolean;
  isLoading: boolean;
  clearSelection: () => void;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

const CITY_STORAGE_KEY = "gp_selected_city";

export const EventProvider = ({ children }: { children: ReactNode }) => {
  const [selectedCityId, setSelectedCityIdState] = useState<string>(() => {
    return localStorage.getItem(CITY_STORAGE_KEY) || MUMBAI_CITY_ID;
  });
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  const setSelectedCityId = (id: string) => {
    setSelectedCityIdState(id);
    localStorage.setItem(CITY_STORAGE_KEY, id);
    // Reset downstream selections when city changes
    setSelectedEventId(null);
    setSelectedLocationId(null);
  };

  // Fetch cities
  const { data: cities = [], isLoading: citiesLoading } = useQuery({
    queryKey: ["cities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cities")
        .select("*")
        .eq("active", true)
        .order("name");
      if (error) throw error;
      return data as City[];
    },
  });

  // Fetch events scoped by city
  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["events", selectedCityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("*")
        .eq("active", true)
        .eq("city_id", selectedCityId)
        .order("name");
      if (error) throw error;
      return data as Event[];
    },
    enabled: !!selectedCityId,
  });

  // Fetch locations scoped by city
  const { data: locations = [], isLoading: locationsLoading } = useQuery({
    queryKey: ["locations", selectedCityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .eq("active", true)
        .eq("city_id", selectedCityId)
        .order("name");
      if (error) throw error;
      return data as Location[];
    },
    enabled: !!selectedCityId,
  });

  const selectedCity = cities.find((c) => c.id === selectedCityId) || null;
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
        cities,
        events,
        locations,
        selectedCityId,
        selectedEventId,
        selectedLocationId,
        setSelectedCityId,
        setSelectedEventId,
        setSelectedLocationId,
        selectedCity,
        selectedEvent,
        selectedLocation,
        requiresLocation,
        isLoading: citiesLoading || eventsLoading || locationsLoading,
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

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
  isContextValid: boolean;
  contextLabel: string;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

const CITY_STORAGE_KEY = "gp_selected_city";
const EVENT_STORAGE_KEY = "gp_selected_event";
const LOCATION_STORAGE_KEY = "gp_selected_location";

export const EventProvider = ({ children }: { children: ReactNode }) => {
  const [selectedCityId, setSelectedCityIdState] = useState<string>(() => {
    return localStorage.getItem(CITY_STORAGE_KEY) || MUMBAI_CITY_ID;
  });
  const [selectedEventId, setSelectedEventIdState] = useState<string | null>(() => {
    return localStorage.getItem(EVENT_STORAGE_KEY) || null;
  });
  const [selectedLocationId, setSelectedLocationIdState] = useState<string | null>(() => {
    return localStorage.getItem(LOCATION_STORAGE_KEY) || null;
  });

  // Persist event selection
  const setSelectedEventId = (id: string | null) => {
    setSelectedEventIdState(id);
    if (id) {
      localStorage.setItem(EVENT_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(EVENT_STORAGE_KEY);
    }
    // Reset downstream
    setSelectedLocationIdState(null);
    localStorage.removeItem(LOCATION_STORAGE_KEY);
  };

  // Persist location selection
  const setSelectedLocationId = (id: string | null) => {
    setSelectedLocationIdState(id);
    if (id) {
      localStorage.setItem(LOCATION_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(LOCATION_STORAGE_KEY);
    }
  };

  const setSelectedCityId = (id: string) => {
    setSelectedCityIdState(id);
    localStorage.setItem(CITY_STORAGE_KEY, id);
    // Reset downstream selections when city changes
    setSelectedEventId(null);
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

  // Validate persisted event/location against loaded data
  useEffect(() => {
    if (eventsLoading || locationsLoading) return;

    // If selected event doesn't exist in current city's events, clear it
    if (selectedEventId && events.length > 0 && !events.find((e) => e.id === selectedEventId)) {
      setSelectedEventId(null);
    }
  }, [events, selectedEventId, eventsLoading, locationsLoading]);

  useEffect(() => {
    if (locationsLoading) return;

    // If selected location doesn't exist in current locations, clear it
    if (selectedLocationId && locations.length > 0 && !locations.find((l) => l.id === selectedLocationId)) {
      setSelectedLocationId(null);
    }
  }, [locations, selectedLocationId, locationsLoading]);

  // Clear location when event changes to non-recurring
  useEffect(() => {
    if (selectedEventId && !requiresLocation) {
      setSelectedLocationId(null);
    }
  }, [selectedEventId, requiresLocation]);

  // Validate city exists
  useEffect(() => {
    if (citiesLoading || cities.length === 0) return;
    if (!cities.find((c) => c.id === selectedCityId)) {
      setSelectedCityId(cities[0]?.id || MUMBAI_CITY_ID);
    }
  }, [cities, selectedCityId, citiesLoading]);

  // Context validity: city exists, event selected and valid
  const isContextValid = !!(
    selectedCity &&
    selectedEvent &&
    (!requiresLocation || selectedLocation)
  );

  // Build context label for display
  const contextLabel = (() => {
    const parts: string[] = [];
    if (selectedCity) parts.push(selectedCity.name);
    if (selectedEvent) parts.push(selectedEvent.name);
    if (selectedLocation) parts.push(selectedLocation.name);
    return parts.join(" · ");
  })();

  const clearSelection = () => {
    setSelectedEventId(null);
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
        isContextValid,
        contextLabel,
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

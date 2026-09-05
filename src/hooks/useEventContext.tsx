import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Legacy seed IDs retained only for backward compatibility with older imports.
// New UI/session resolution must use the selected city's loaded event records.
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
  scopeEventType: "social" | "thursdays" | null;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

const CITY_STORAGE_KEY = "gp_selected_city";
const EVENT_STORAGE_KEY = "gp_selected_event";
const LOCATION_STORAGE_KEY = "gp_selected_location";

export const EventProvider = ({ children }: { children: ReactNode }) => {
  const [selectedCityId, setSelectedCityIdState] = useState<string>(() => {
    return localStorage.getItem(CITY_STORAGE_KEY) || "";
  });
  const [selectedEventId, setSelectedEventIdState] = useState<string | null>(() => {
    return localStorage.getItem(EVENT_STORAGE_KEY) || null;
  });
  const [selectedLocationId, setSelectedLocationIdState] = useState<string | null>(() => {
    return localStorage.getItem(LOCATION_STORAGE_KEY) || null;
  });

  const setSelectedEventId = (id: string | null) => {
    setSelectedEventIdState(id);
    if (id) {
      localStorage.setItem(EVENT_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(EVENT_STORAGE_KEY);
    }
    setSelectedLocationIdState(null);
    localStorage.removeItem(LOCATION_STORAGE_KEY);
  };

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
    setSelectedEventId(null);
  };

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

  const selectedCity = cities.find((city) => city.id === selectedCityId) || null;
  const selectedEvent = events.find((event) => event.id === selectedEventId) || null;
  const selectedLocation = locations.find((location) => location.id === selectedLocationId) || null;

  const requiresLocation = selectedEvent?.event_type === "recurring";
  const scopeEventType: "social" | "thursdays" | null = selectedEvent
    ? selectedEvent.event_type === "one_off"
      ? "social"
      : "thursdays"
    : null;

  // Pick the first active city only when there is no valid persisted city. This
  // keeps Mumbai as today's natural default without baking its UUID into routing.
  useEffect(() => {
    if (citiesLoading || cities.length === 0) return;
    if (!selectedCityId || !cities.some((city) => city.id === selectedCityId)) {
      const fallbackCityId = cities[0].id;
      setSelectedCityIdState(fallbackCityId);
      localStorage.setItem(CITY_STORAGE_KEY, fallbackCityId);
      setSelectedEventIdState(null);
      setSelectedLocationIdState(null);
      localStorage.removeItem(EVENT_STORAGE_KEY);
      localStorage.removeItem(LOCATION_STORAGE_KEY);
    }
  }, [cities, selectedCityId, citiesLoading]);

  // Clear an event persisted from another city as soon as this city's events load.
  useEffect(() => {
    if (eventsLoading) return;
    if (selectedEventId && !events.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(null);
    }
  }, [events, selectedEventId, eventsLoading]);

  useEffect(() => {
    if (locationsLoading) return;
    if (selectedLocationId && !locations.some((location) => location.id === selectedLocationId)) {
      setSelectedLocationId(null);
    }
  }, [locations, selectedLocationId, locationsLoading]);

  useEffect(() => {
    if (selectedEventId && !requiresLocation) {
      setSelectedLocationId(null);
    }
  }, [selectedEventId, requiresLocation]);

  const isContextValid = !!(
    selectedCity &&
    selectedEvent &&
    (!requiresLocation || selectedLocation)
  );

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
        scopeEventType,
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

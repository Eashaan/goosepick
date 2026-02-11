import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import { useEventContext } from "@/hooks/useEventContext";

interface CourtGroup {
  id: string;
  court_ids: number[];
}

const PublicCourtSelector = () => {
  const navigate = useNavigate();
  const {
    selectedCityId,
    selectedEventId,
    selectedLocationId,
    selectedEvent,
    selectedLocation,
    requiresLocation,
    isContextValid,
    clearSelection,
  } = useEventContext();

  useEffect(() => {
    if (!isContextValid) {
      navigate("/", { replace: true });
    }
  }, [isContextValid, navigate]);

  // Fetch session config
  const { data: sessionConfig } = useQuery({
    queryKey: ["session_config", selectedCityId, selectedEventId, selectedLocationId],
    queryFn: async () => {
      let query = supabase
        .from("session_configs" as any)
        .select("*")
        .eq("city_id", selectedCityId)
        .eq("event_id", selectedEventId!);
      if (selectedLocationId) {
        query = query.eq("location_id", selectedLocationId);
      } else {
        query = query.is("location_id", null);
      }
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as unknown as { id: string; setup_completed: boolean } | null;
    },
    enabled: isContextValid,
  });

  // Fetch court groups
  const { data: courtGroups = [] } = useQuery({
    queryKey: ["court_groups", sessionConfig?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("court_groups" as any)
        .select("*")
        .eq("session_config_id", sessionConfig!.id);
      if (error) throw error;
      return (data || []) as unknown as CourtGroup[];
    },
    enabled: !!sessionConfig?.id,
  });

  // Fetch courts
  const { data: courts = [] } = useQuery({
    queryKey: ["courts", selectedEventId, selectedLocationId],
    queryFn: async () => {
      let query = supabase.from("courts").select("*").order("id");
      if (selectedEventId) query = query.eq("event_id", selectedEventId);
      if (selectedLocationId) {
        query = query.eq("location_id", selectedLocationId);
      } else if (selectedEventId && !requiresLocation) {
        query = query.is("location_id", null);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: isContextValid,
  });

  const handleBackToHome = () => {
    clearSelection();
    navigate("/");
  };

  const contextLabel = selectedEvent
    ? selectedLocation
      ? `${selectedEvent.name} – ${selectedLocation.name}`
      : selectedEvent.name
    : "";

  if (!isContextValid) return null;

  // Build display items with group awareness
  const groupedCourtIdSet = new Set(courtGroups.flatMap((g) => g.court_ids));
  const ungroupedCourts = courts.filter((c) => !groupedCourtIdSet.has(c.id));

  const displayItems: { key: string; label: string; isGroup: boolean; courtId?: number }[] = [];

  ungroupedCourts.forEach((c) => {
    displayItems.push({ key: `court-${c.id}`, label: c.name, isGroup: false, courtId: c.id });
  });

  courtGroups.forEach((g) => {
    const groupCourts = courts.filter((c) => g.court_ids.includes(c.id)).sort((a, b) => a.id - b.id);
    const numbers = groupCourts.map((c) => c.name.replace("Court ", ""));
    let label: string;
    if (numbers.length === 2) {
      label = `Courts ${numbers[0]} & ${numbers[1]}`;
    } else {
      const last = numbers[numbers.length - 1];
      const rest = numbers.slice(0, -1);
      label = `Courts ${rest.join(", ")} & ${last}`;
    }
    displayItems.push({ key: `group-${g.id}`, label, isGroup: true });
  });

  return (
    <PageLayout>
      <GlobalHeader />
      <div className="min-h-screen px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-8 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={handleBackToHome} className="shrink-0">
              <ChevronLeft className="h-6 w-6" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Select Your Court</h1>
              <p className="text-sm text-muted-foreground">{contextLabel}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {displayItems.map((item) =>
              item.isGroup ? (
                <Button
                  key={item.key}
                  variant="secondary"
                  className="h-24 text-base font-semibold rounded-2xl opacity-70 cursor-default flex flex-col items-center justify-center gap-1"
                  disabled
                >
                  <span>{item.label}</span>
                  <span className="text-xs font-normal text-muted-foreground">Coming soon</span>
                </Button>
              ) : (
                <Button
                  key={item.key}
                  asChild
                  variant="secondary"
                  className="h-24 text-xl font-semibold rounded-2xl hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                >
                  <Link to={`/public/court/${item.courtId}`}>{item.label}</Link>
                </Button>
              )
            )}
            {displayItems.length === 0 && courts.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                No courts found for this event/location.
              </div>
            )}
          </div>

          <div className="mt-12 text-center">
            <button
              onClick={handleBackToHome}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to Home
            </button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default PublicCourtSelector;

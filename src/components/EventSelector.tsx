import { Button } from "@/components/ui/button";
import { useEventContext, GOOSEPICK_SOCIAL_ID, GOOSEPICK_THURSDAYS_ID } from "@/hooks/useEventContext";
import { MapPin } from "lucide-react";

interface EventSelectorProps {
  onComplete: () => void;
}

const EventSelector = ({ onComplete }: EventSelectorProps) => {
  const {
    events,
    locations,
    selectedEventId,
    selectedLocationId,
    setSelectedEventId,
    setSelectedLocationId,
    requiresLocation,
    isLoading,
  } = useEventContext();

  // Filter locations for selected event
  const eventLocations = locations.filter((l) => l.event_id === selectedEventId);

  // Check if selection is complete
  const canProceed = selectedEventId && (!requiresLocation || selectedLocationId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-muted-foreground">Loading events...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Event Selection */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-center">Select Event</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {events.map((event) => (
            <Button
              key={event.id}
              variant={selectedEventId === event.id ? "default" : "secondary"}
              className={`h-20 text-lg font-semibold rounded-2xl transition-all duration-200 ${
                selectedEventId === event.id
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "hover:bg-primary/10"
              }`}
              onClick={() => setSelectedEventId(event.id)}
            >
              <div className="flex flex-col items-center gap-1">
                <span>{event.name}</span>
                {event.event_type === "recurring" && (
                  <span className="text-xs opacity-70 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> Multi-location
                  </span>
                )}
              </div>
            </Button>
          ))}
        </div>
      </div>

      {/* Location Selection (only for recurring events) */}
      {requiresLocation && eventLocations.length > 0 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <h2 className="text-lg font-semibold text-center">Select Location</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {eventLocations.map((location) => (
              <Button
                key={location.id}
                variant={selectedLocationId === location.id ? "default" : "secondary"}
                className={`h-16 text-base font-semibold rounded-xl transition-all duration-200 ${
                  selectedLocationId === location.id
                    ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                    : "hover:bg-primary/10"
                }`}
                onClick={() => setSelectedLocationId(location.id)}
              >
                {location.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Continue Button */}
      {canProceed && (
        <div className="pt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <Button
            onClick={onComplete}
            className="w-full h-14 text-lg font-semibold rounded-xl"
          >
            Continue to Courts
          </Button>
        </div>
      )}
    </div>
  );
};

export default EventSelector;

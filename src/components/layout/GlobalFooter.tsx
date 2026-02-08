import { useEventContext, GOOSEPICK_THURSDAYS_ID } from "@/hooks/useEventContext";
import { format } from "date-fns";

const GlobalFooter = () => {
  const { selectedEvent, selectedCity, selectedLocation } = useEventContext();

  const today = format(new Date(), "MMMM d, yyyy");
  const cityName = selectedCity?.name || "Mumbai";
  const eventName = selectedEvent?.name || "Goosepick Social";
  const isThursdays = selectedEvent?.id === GOOSEPICK_THURSDAYS_ID;

  const footerText = isThursdays && selectedLocation
    ? `${eventName} ${cityName} – ${today} – ${selectedLocation.name}`
    : `${eventName} ${cityName} – ${today}`;

  return (
    <footer className="fixed bottom-0 left-0 right-0 py-4 text-center">
      <p className="text-xs text-muted-foreground tracking-wide">
        {footerText}
      </p>
    </footer>
  );
};

export default GlobalFooter;

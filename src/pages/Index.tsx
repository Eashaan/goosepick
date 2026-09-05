import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import PageLayout from "@/components/layout/PageLayout";
import { useEventContext } from "@/hooks/useEventContext";
import goosepickExperiencesLogo from "@/assets/goosepick-experiences-logo.png";

const Index = () => {
  const navigate = useNavigate();
  const {
    cities,
    events,
    locations,
    selectedCityId,
    selectedEventId,
    selectedLocationId,
    setSelectedCityId,
    setSelectedEventId,
    setSelectedLocationId,
    requiresLocation,
    isLoading,
  } = useEventContext();

  // Event records are resolved from the currently selected city instead of using
  // Mumbai-era fixed UUIDs. This keeps the home flow valid when Delhi/Bengaluru
  // get their own Social and Thursdays event rows.
  const socialEvent = events.find((event) => event.event_type === "one_off") || null;
  const thursdaysEvent = events.find((event) => event.event_type === "recurring") || null;
  const socialEventId = socialEvent?.id || null;
  const thursdaysEventId = thursdaysEvent?.id || null;

  // Locations are also bound to the selected city's actual Thursdays event.
  const thursdaysLocations = thursdaysEventId
    ? locations
        .filter((location) => location.event_id === thursdaysEventId)
        .sort((a, b) => {
          if (a.name.toLowerCase().includes("bandra")) return -1;
          if (b.name.toLowerCase().includes("bandra")) return 1;
          return a.name.localeCompare(b.name);
        })
    : [];

  const canShowCtas = selectedEventId && (!requiresLocation || selectedLocationId);

  const handleContinueToRoster = () => {
    navigate("/public");
  };

  const handleAdminLogin = () => {
    navigate("/admin/login");
  };

  const handleEventSelect = (eventId: string | null) => {
    if (!eventId) return;
    setSelectedEventId(eventId);
    setSelectedLocationId(null);
  };

  if (isLoading) {
    return (
      <PageLayout showFooter={false}>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout showFooter={false}>
      <div className="flex min-h-screen flex-col items-center justify-center px-6 relative">
        {/* City Selector - Top Right */}
        <div className="absolute top-6 right-6">
          <Select value={selectedCityId} onValueChange={setSelectedCityId}>
            <SelectTrigger className="w-[130px] h-9 text-sm bg-secondary border-border rounded-lg">
              <SelectValue placeholder="City" />
            </SelectTrigger>
            <SelectContent>
              {cities.map((city) => (
                <SelectItem key={city.id} value={city.id}>
                  {city.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Logo */}
        <div className="mb-12 animate-fade-in flex-shrink-0">
          <div className="w-48 h-48 md:w-64 md:h-64">
            <img
              src={goosepickExperiencesLogo}
              alt="Goosepick Experiences"
              className="w-full h-full object-contain"
            />
          </div>
        </div>

        {/* Event Selection */}
        <div className="flex flex-col items-center gap-6 animate-slide-up w-full max-w-md">
          {/* Event Buttons */}
          <div className="grid grid-cols-1 gap-4 w-full sm:grid-cols-2">
            <Button
              size="lg"
              variant={selectedEventId === socialEventId ? "default" : "secondary"}
              disabled={!socialEventId}
              className={`h-16 text-lg font-semibold rounded-2xl transition-all duration-200 ${
                selectedEventId === socialEventId
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "hover:bg-primary/10"
              }`}
              onClick={() => handleEventSelect(socialEventId)}
            >
              {socialEvent?.name || "Goosepick Social"}
            </Button>
            <Button
              size="lg"
              variant={selectedEventId === thursdaysEventId ? "default" : "secondary"}
              disabled={!thursdaysEventId}
              className={`h-16 text-lg font-semibold rounded-2xl transition-all duration-200 ${
                selectedEventId === thursdaysEventId
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "hover:bg-primary/10"
              }`}
              onClick={() => handleEventSelect(thursdaysEventId)}
            >
              {thursdaysEvent?.name || "Goosepick Thursdays"}
            </Button>
          </div>

          {/* Location Selection (Thursdays only) */}
          {selectedEventId === thursdaysEventId && thursdaysLocations.length > 0 && (
            <div className="w-full animate-in fade-in slide-in-from-top-2 duration-300">
              <div className="grid grid-cols-2 gap-4">
                {thursdaysLocations.map((location) => (
                  <Button
                    key={location.id}
                    size="lg"
                    variant={selectedLocationId === location.id ? "default" : "secondary"}
                    className={`h-14 text-base font-semibold rounded-xl transition-all duration-200 ${
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

          {/* CTAs */}
          {canShowCtas && (
            <div className="flex flex-col items-center gap-4 pt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <Button
                size="lg"
                className="min-w-[280px] h-14 text-lg font-semibold rounded-2xl bg-primary hover:bg-primary/90 shadow-glow hover:shadow-glow-lg transition-all duration-300"
                onClick={handleContinueToRoster}
              >
                Continue to Roster
              </Button>
              <button
                onClick={handleAdminLogin}
                className="text-primary hover:text-primary/80 underline underline-offset-4 text-sm font-medium transition-colors"
              >
                Admin Login
              </button>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
};

export default Index;

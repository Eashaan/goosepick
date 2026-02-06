import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import PageLayout from "@/components/layout/PageLayout";
import { useEventContext, GOOSEPICK_SOCIAL_ID, GOOSEPICK_THURSDAYS_ID } from "@/hooks/useEventContext";
import goosepickExperiencesLogo from "@/assets/goosepick-experiences-logo.png";

const Index = () => {
  const navigate = useNavigate();
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

  // Filter locations for Thursdays event, sorted with Bandra first
  const thursdaysLocations = locations
    .filter((l) => l.event_id === GOOSEPICK_THURSDAYS_ID)
    .sort((a, b) => {
      // Bandra first, Andheri second
      if (a.name.toLowerCase().includes("bandra")) return -1;
      if (b.name.toLowerCase().includes("bandra")) return 1;
      return a.name.localeCompare(b.name);
    });

  // Check if we can show CTAs
  const canShowCtas = selectedEventId && (!requiresLocation || selectedLocationId);

  const handleContinueToRoster = () => {
    navigate("/public");
  };

  const handleAdminLogin = () => {
    navigate("/admin/login");
  };

  const handleEventSelect = (eventId: string) => {
    setSelectedEventId(eventId);
    // Clear location when switching events
    setSelectedLocationId(null);
  };

  if (isLoading) {
    return (
      <PageLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        {/* Logo - Fixed aspect ratio container */}
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
              variant={selectedEventId === GOOSEPICK_SOCIAL_ID ? "default" : "secondary"}
              className={`h-16 text-lg font-semibold rounded-2xl transition-all duration-200 ${
                selectedEventId === GOOSEPICK_SOCIAL_ID
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "hover:bg-primary/10"
              }`}
              onClick={() => handleEventSelect(GOOSEPICK_SOCIAL_ID)}
            >
              Goosepick Social
            </Button>
            <Button
              size="lg"
              variant={selectedEventId === GOOSEPICK_THURSDAYS_ID ? "default" : "secondary"}
              className={`h-16 text-lg font-semibold rounded-2xl transition-all duration-200 ${
                selectedEventId === GOOSEPICK_THURSDAYS_ID
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "hover:bg-primary/10"
              }`}
              onClick={() => handleEventSelect(GOOSEPICK_THURSDAYS_ID)}
            >
              Goosepick Thursdays
            </Button>
          </div>

          {/* Location Selection (Thursdays only) */}
          {selectedEventId === GOOSEPICK_THURSDAYS_ID && thursdaysLocations.length > 0 && (
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

          {/* CTAs - Only show after valid selection */}
          {canShowCtas && (
            <div className="flex flex-col items-center gap-4 pt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* Primary CTA */}
              <Button
                size="lg"
                className="min-w-[280px] h-14 text-lg font-semibold rounded-2xl bg-primary hover:bg-primary/90 shadow-glow hover:shadow-glow-lg transition-all duration-300"
                onClick={handleContinueToRoster}
              >
                Continue to Roster
              </Button>

              {/* Secondary CTA - Admin Login */}
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

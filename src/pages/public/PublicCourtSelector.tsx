import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import { useEventContext } from "@/hooks/useEventContext";
import { useScopedCourts } from "@/hooks/useScopedCourts";
import { useActiveSession } from "@/hooks/useActiveSession";

const PublicCourtSelector = () => {
  const navigate = useNavigate();
  const {
    selectedEvent,
    selectedLocation,
    isContextValid,
    clearSelection,
  } = useEventContext();

  const { renderItems, configLoading } = useScopedCourts();
  const { isEnded, activeSession, sessionLoading } = useActiveSession();

  useEffect(() => {
    if (!isContextValid) {
      navigate("/", { replace: true });
    }
  }, [isContextValid, navigate]);

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

          {isEnded && (
            <div className="mb-4 rounded-xl bg-secondary/50 p-4 text-center">
              <p className="text-sm text-muted-foreground">This session has ended. Viewing in read-only mode.</p>
            </div>
          )}

          {!sessionLoading && !configLoading && (!activeSession || activeSession.status === 'draft') && (
            <div className="text-center py-12 text-muted-foreground">
              No live session right now. Check back soon!
            </div>
          )}

          {activeSession && (activeSession.status === 'live' || activeSession.status === 'ended') && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {renderItems.map((item) => {
                if (item.type === "group") {
                  if (item.courtGroupId) {
                    return (
                      <Button
                        key={item.key}
                        asChild
                        variant="secondary"
                        className="h-24 text-base font-semibold rounded-2xl hover:bg-primary hover:text-primary-foreground transition-all duration-200 flex flex-col items-center justify-center gap-1"
                      >
                        <Link to={`/public/group/${item.courtGroupId}`}>
                          <span>{item.label}</span>
                        </Link>
                      </Button>
                    );
                  }

                  return (
                    <Button
                      key={item.key}
                      variant="secondary"
                      className="h-24 text-base font-semibold rounded-2xl opacity-70 cursor-default flex flex-col items-center justify-center gap-1"
                      disabled
                    >
                      <span>{item.label}</span>
                      <span className="text-xs font-normal text-muted-foreground">Not ready</span>
                    </Button>
                  );
                }

                return (
                  <Button
                    key={item.key}
                    asChild
                    variant="secondary"
                    className="h-24 text-xl font-semibold rounded-2xl hover:bg-primary hover:text-primary-foreground transition-all duration-200"
                  >
                    <Link to={item.courtId ? `/public/court/${item.courtId}` : "#"}>
                      {item.label}
                    </Link>
                  </Button>
                );
              })}
              {renderItems.length === 0 && !configLoading && (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  No courts found for this event/location.
                </div>
              )}
            </div>
          )}

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

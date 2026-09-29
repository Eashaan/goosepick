import { useNavigate } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import { useEventContext } from "@/hooks/useEventContext";
import { ROLE_LABELS, type StaffRole } from "@/lib/rbac";

interface AdminHomeProps {
  email?: string | null;
  role: StaffRole;
  canSchedule: boolean;
  onLogout: () => void;
}

/**
 * Admin context picker (city → experience → locality). Shown inside /admin when
 * no event context is selected, so the admin flow never bounces through "/".
 * Uses the shared EventContext setters; once the context is valid the
 * dashboard renders in place.
 */
const AdminHome = ({ email, role, canSchedule, onLogout }: AdminHomeProps) => {
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

  const cityEvents = events.filter((e) => !e.city_id || e.city_id === selectedCityId);
  const eventLocations = locations.filter(
    (l) => l.event_id === selectedEventId && (!l.city_id || l.city_id === selectedCityId),
  );

  const pill = (active: boolean) =>
    `h-14 rounded-xl text-base font-semibold ${active ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`;

  return (
    <PageLayout>
      <GlobalHeader />
      <div className="min-h-screen px-6 py-8">
        <div className="mx-auto max-w-2xl space-y-8" data-testid="admin-home">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Admin Home</h1>
              <p className="text-xs text-muted-foreground">
                {email ? `Signed in as ${email} · ` : ""}
                {ROLE_LABELS[role]}
              </p>
            </div>
            {canSchedule && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => navigate("/admin/schedule")}>
                <CalendarDays className="h-4 w-4" />
                Schedule
              </Button>
            )}
          </div>

          {isLoading ? (
            <p className="text-center text-muted-foreground">Loading...</p>
          ) : (
            <>
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">City</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {cities.map((c) => (
                    <Button
                      key={c.id}
                      variant={selectedCityId === c.id ? "default" : "secondary"}
                      className={pill(selectedCityId === c.id)}
                      onClick={() => setSelectedCityId(c.id)}
                    >
                      {c.name}
                    </Button>
                  ))}
                </div>
              </section>

              {selectedCityId && (
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Experience</h2>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {cityEvents.map((e) => (
                      <Button
                        key={e.id}
                        variant={selectedEventId === e.id ? "default" : "secondary"}
                        className={pill(selectedEventId === e.id)}
                        onClick={() => setSelectedEventId(e.id)}
                      >
                        {e.name}
                      </Button>
                    ))}
                  </div>
                </section>
              )}

              {selectedEventId && requiresLocation && (
                <section className="space-y-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Locality</h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {eventLocations.map((l) => (
                      <Button
                        key={l.id}
                        variant={selectedLocationId === l.id ? "default" : "secondary"}
                        className={pill(selectedLocationId === l.id)}
                        onClick={() => setSelectedLocationId(l.id)}
                      >
                        {l.name}
                      </Button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          <div className="pt-8 text-center">
            <Button variant="ghost" onClick={onLogout} className="text-muted-foreground hover:text-foreground">
              Logout
            </Button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default AdminHome;

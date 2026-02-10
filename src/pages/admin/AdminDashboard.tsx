import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import AdminContextBanner from "@/components/admin/AdminContextBanner";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useEventContext } from "@/hooks/useEventContext";

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { isAdmin, isLoading, signOut, user } = useAdminAuth();
  const {
    selectedEventId,
    selectedLocationId,
    selectedEvent,
    selectedLocation,
    requiresLocation,
    isContextValid,
    clearSelection,
  } = useEventContext();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      navigate("/admin/login");
    }
  }, [isLoading, isAdmin, navigate]);

  // Redirect to home if context is invalid
  useEffect(() => {
    if (!isLoading && isAdmin && !isContextValid) {
      navigate("/", { replace: true });
    }
  }, [isLoading, isAdmin, isContextValid, navigate]);

  const handleLogout = async () => {
    await signOut();
    clearSelection();
    navigate("/");
  };

  const handleBackToHome = () => {
    clearSelection();
    navigate("/");
  };

  // Fetch courts for the selected event/location
  const { data: courts = [] } = useQuery({
    queryKey: ["courts", selectedEventId, selectedLocationId],
    queryFn: async () => {
      let query = supabase.from("courts").select("*").order("id");
      
      if (selectedEventId) {
        query = query.eq("event_id", selectedEventId);
      }
      
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

  if (isLoading) {
    return (
      <PageLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </PageLayout>
    );
  }

  if (!isAdmin || !isContextValid) {
    return null;
  }

  // Build the context label
  const contextLabel = selectedEvent
    ? selectedLocation
      ? `${selectedEvent.name} – ${selectedLocation.name}`
      : selectedEvent.name
    : "";

  return (
    <PageLayout>
      <GlobalHeader />
      <AdminContextBanner />
      <div className="min-h-screen px-6 py-8">
        <div className="mx-auto max-w-2xl">
          {/* Header with back button */}
          <div className="mb-8 flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleBackToHome}
              className="shrink-0"
            >
              <ChevronLeft className="h-6 w-6" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
              <p className="text-sm text-muted-foreground">{contextLabel}</p>
              {user?.email && (
                <p className="text-xs text-muted-foreground">
                  Signed in as {user.email}
                </p>
              )}
            </div>
          </div>

          {/* Courts Grid */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {courts.map((court) => (
              <Button
                key={court.id}
                asChild
                variant="secondary"
                className="h-24 text-xl font-semibold rounded-2xl hover:bg-primary hover:text-primary-foreground transition-all duration-200"
              >
                <Link to={`/admin/court/${court.id}`}>
                  {court.name}
                </Link>
              </Button>
            ))}
            {courts.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                No courts found for this event/location.
              </div>
            )}
          </div>

          <div className="mt-12 text-center">
            <Button
              variant="ghost"
              onClick={handleLogout}
              className="text-muted-foreground hover:text-foreground"
            >
              Logout
            </Button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default AdminDashboard;

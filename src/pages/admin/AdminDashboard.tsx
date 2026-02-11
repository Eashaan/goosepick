import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Settings } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import AdminContextBanner from "@/components/admin/AdminContextBanner";
import SetupWizard from "@/components/admin/SetupWizard";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useEventContext } from "@/hooks/useEventContext";

interface SessionConfig {
  id: string;
  city_id: string;
  event_id: string;
  location_id: string | null;
  court_count: number;
  setup_completed: boolean;
}

interface CourtGroup {
  id: string;
  session_config_id: string;
  court_ids: number[];
  format_type: string;
}

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { isAdmin, isLoading, signOut, user } = useAdminAuth();
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

  const [showEditSetup, setShowEditSetup] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      navigate("/admin/login");
    }
  }, [isLoading, isAdmin, navigate]);

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

  // Fetch session config for current context
  const { data: sessionConfig, isLoading: configLoading } = useQuery({
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
      return data as unknown as SessionConfig | null;
    },
    enabled: isContextValid,
  });

  // Fetch court groups for this config
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

  // Fetch courts for the selected event/location
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
    enabled: isContextValid && !!sessionConfig?.setup_completed,
  });

  // Check which courts have matches (for per-court lock detection)
  // Returns a Set of court numbers (extracted from court names like "Court 1")
  const { data: lockedCourtNumbers = new Set<number>() } = useQuery({
    queryKey: ["locked_courts", selectedEventId, selectedLocationId, courts.map(c => c.id).join(",")],
    queryFn: async () => {
      const courtIds = courts.map((c) => c.id);
      if (courtIds.length === 0) return new Set<number>();
      const { data, error } = await supabase
        .from("matches")
        .select("court_id")
        .in("court_id", courtIds);
      if (error) return new Set<number>();
      // Map DB court_ids back to court numbers
      const lockedDbIds = new Set((data || []).map((m) => m.court_id));
      const courtNumbers = new Set<number>();
      courts.forEach((c) => {
        if (lockedDbIds.has(c.id)) {
          const num = parseInt(c.name.replace("Court ", ""));
          if (!isNaN(num)) courtNumbers.add(num);
        }
      });
      return courtNumbers;
    },
    enabled: courts.length > 0,
  });

  if (isLoading || configLoading) {
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

  const setupCompleted = sessionConfig?.setup_completed === true;
  const hasAnyMatches = lockedCourtNumbers.size > 0;

  // Build grouped court IDs set
  const groupedCourtIdSet = new Set(courtGroups.flatMap((g) => g.court_ids));

  // Ungrouped courts
  const ungroupedCourts = courts.filter((c) => !groupedCourtIdSet.has(c.id));

  // Build display items
  const displayItems: { key: string; label: string; isGroup: boolean; courtId?: number; groupId?: string }[] = [];

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
    displayItems.push({ key: `group-${g.id}`, label, isGroup: true, groupId: g.id });
  });

  const handleSetupComplete = () => {
    setShowEditSetup(false);
  };

  // Show wizard if no setup exists or edit mode
  const showWizard = !setupCompleted || showEditSetup;

  return (
    <PageLayout>
      <GlobalHeader />
      <AdminContextBanner />
      <div className="min-h-screen px-6 py-8">
        <div className="mx-auto max-w-2xl">
          {/* Header */}
          <div className="mb-8 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={handleBackToHome} className="shrink-0">
              <ChevronLeft className="h-6 w-6" />
            </Button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
              {user?.email && (
                <p className="text-xs text-muted-foreground">Signed in as {user.email}</p>
              )}
            </div>
            {setupCompleted && !showEditSetup && (
              <Button variant="ghost" size="icon" onClick={() => setShowEditSetup(true)}>
                <Settings className="h-5 w-5" />
              </Button>
            )}
          </div>

          {showWizard ? (
            <SetupWizard
              cityId={selectedCityId}
              eventId={selectedEventId!}
              locationId={selectedLocationId}
              existingConfigId={sessionConfig?.id}
              existingCourtCount={sessionConfig?.court_count}
              lockedCourtIds={lockedCourtNumbers}
              onComplete={handleSetupComplete}
            />
          ) : (
            <>
              {/* Per-court lock info */}
              {hasAnyMatches && (
                <div className="mb-4 rounded-lg bg-muted/50 p-3 text-center text-sm text-muted-foreground">
                  Some courts are locked because matches have been generated. Reset individual courts to unlock them.
                </div>
              )}

              {/* Courts & Groups Grid */}
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
                      <Link to={`/admin/court/${item.courtId}`}>{item.label}</Link>
                    </Button>
                  )
                )}
                {displayItems.length === 0 && (
                  <div className="col-span-full text-center py-12 text-muted-foreground">
                    No courts configured yet.
                  </div>
                )}
              </div>
            </>
          )}

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

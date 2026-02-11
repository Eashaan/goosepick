import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Settings } from "lucide-react";
import { toast } from "sonner";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import AdminContextBanner from "@/components/admin/AdminContextBanner";
import SetupWizard from "@/components/admin/SetupWizard";
import SessionSummaryStrip from "@/components/admin/SessionSummaryStrip";
import CourtStatusCard, { type CourtStatus } from "@/components/admin/CourtStatusCard";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useEventContext } from "@/hooks/useEventContext";

interface SessionConfig {
  id: string;
  city_id: string;
  event_id: string;
  event_type: "social" | "thursdays";
  location_id: string | null;
  court_count: number;
  setup_completed: boolean;
}

interface CourtUnit {
  id: string;
  city_id: string;
  event_type: "social" | "thursdays";
  location_id: string | null;
  type: "court" | "group";
  court_number: number | null;
  group_court_numbers: number[] | null;
  display_name: string;
  format_type: string;
  is_locked: boolean;
  court_id: number | null;
}

interface CourtState {
  court_id: number;
  phase: "idle" | "in_progress" | "completed";
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
    scopeEventType,
  } = useEventContext();

  const [showEditSetup, setShowEditSetup] = useState(false);
  const [creatingCourtNum, setCreatingCourtNum] = useState<number | null>(null);

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

  // 1. Fetch session config scoped by city + event_type + location
  const { data: sessionConfig, isLoading: configLoading } = useQuery({
    queryKey: ["session_config", selectedCityId, scopeEventType, selectedLocationId],
    queryFn: async () => {
      let query = supabase
        .from("session_configs" as any)
        .select("*")
        .eq("city_id", selectedCityId)
        .eq("event_type", scopeEventType!);

      if (selectedLocationId) {
        query = query.eq("location_id", selectedLocationId);
      } else {
        query = query.is("location_id", null);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as unknown as SessionConfig | null;
    },
    enabled: isContextValid && !!scopeEventType,
  });

  // 2. Fetch court_units scoped by city + event_type + location
  const { data: courtUnits = [] } = useQuery({
    queryKey: ["court_units", selectedCityId, scopeEventType, selectedLocationId],
    queryFn: async () => {
      let query = supabase
        .from("court_units" as any)
        .select("*")
        .eq("city_id", selectedCityId)
        .eq("event_type", scopeEventType!);

      if (selectedLocationId) {
        query = query.eq("location_id", selectedLocationId);
      } else {
        query = query.is("location_id", null);
      }

      const { data, error } = await (query as any).order("court_number", { nullsFirst: false });
      if (error) throw error;
      return (data || []) as unknown as CourtUnit[];
    },
    enabled: isContextValid && !!scopeEventType && !!sessionConfig?.setup_completed,
  });

  // Partition court_units
  const courtTypeUnits = courtUnits.filter((u) => u.type === "court");
  const groupTypeUnits = courtUnits.filter((u) => u.type === "group");

  // Grouped court numbers (from all groups)
  const groupedCourtNumbers = new Set<number>();
  groupTypeUnits.forEach((g) => {
    (g.group_court_numbers || []).forEach((n) => groupedCourtNumbers.add(n));
  });

  // Ungrouped courts = court-type units whose court_number is NOT in any group
  const ungroupedUnits = courtTypeUnits
    .filter((u) => u.court_number !== null && !groupedCourtNumbers.has(u.court_number!))
    .sort((a, b) => (a.court_number || 0) - (b.court_number || 0));

  // Groups sorted by min court number
  const sortedGroups = [...groupTypeUnits].sort((a, b) => {
    const aMin = Math.min(...(a.group_court_numbers || [0]));
    const bMin = Math.min(...(b.group_court_numbers || [0]));
    return aMin - bMin;
  });

  // 3. Fetch court_state for all linked court_ids
  const linkedCourtIds = courtUnits
    .filter((u) => u.court_id != null)
    .map((u) => u.court_id!);

  const { data: courtStates = [] } = useQuery({
    queryKey: ["court_states_dashboard", linkedCourtIds.join(",")],
    queryFn: async () => {
      if (linkedCourtIds.length === 0) return [];
      const { data, error } = await supabase
        .from("court_state")
        .select("court_id, phase")
        .in("court_id", linkedCourtIds);
      if (error) return [];
      return (data || []) as CourtState[];
    },
    enabled: linkedCourtIds.length > 0,
  });

  // 4. Fetch match counts per court
  const { data: courtMatchCounts = new Map<number, number>() } = useQuery({
    queryKey: ["court_match_counts", linkedCourtIds.join(",")],
    queryFn: async () => {
      if (linkedCourtIds.length === 0) return new Map<number, number>();
      const { data, error } = await supabase
        .from("matches")
        .select("court_id")
        .in("court_id", linkedCourtIds);
      if (error) return new Map<number, number>();
      const counts = new Map<number, number>();
      (data || []).forEach((m) => {
        counts.set(m.court_id, (counts.get(m.court_id) || 0) + 1);
      });
      return counts;
    },
    enabled: linkedCourtIds.length > 0,
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
  const courtCount = sessionConfig?.court_count || 0;

  // === STATUS HELPERS ===
  const getUnitStatus = (unit: CourtUnit): CourtStatus => {
    if (!unit.court_id) return "setup";
    const matchCount = courtMatchCounts.get(unit.court_id) || 0;
    if (matchCount === 0) return "setup";
    const state = courtStates.find((s) => s.court_id === unit.court_id);
    if (state?.phase === "completed") return "completed";
    if (state?.phase === "in_progress") return "live";
    return "locked";
  };

  const getGroupStatus = (group: CourtUnit): CourtStatus => {
    const courtNums = group.group_court_numbers || [];
    const constituentUnits = courtTypeUnits.filter(
      (u) => u.court_number !== null && courtNums.includes(u.court_number!)
    );
    const statuses = constituentUnits.map(getUnitStatus);
    if (statuses.includes("live")) return "live";
    if (statuses.includes("completed")) return "completed";
    if (statuses.includes("locked")) return "locked";
    return "setup";
  };

  // === SUMMARY COUNTS ===
  const allUnitStatuses: CourtStatus[] = [
    ...ungroupedUnits.map(getUnitStatus),
    ...sortedGroups.map(getGroupStatus),
  ];
  const activeCount = allUnitStatuses.filter((s) => s !== "setup").length;
  const liveCount = allUnitStatuses.filter((s) => s === "live").length;

  const handleSetupComplete = () => {
    setShowEditSetup(false);
  };

  // Auto-create court DB row + link court_unit on click, then navigate
  const handleCourtClick = async (unit: CourtUnit) => {
    if (!unit.court_number) return;
    setCreatingCourtNum(unit.court_number);
    try {
      // Create courts row
      const { data, error } = await supabase
        .from("courts")
        .insert({
          name: `Court ${unit.court_number}`,
          event_id: selectedEventId,
          location_id: selectedLocationId || null,
          format_type: unit.format_type as any,
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      const courtId = (data as any).id;

      // Create court_state
      await supabase.from("court_state").insert({ court_id: courtId } as any);

      // Link court_unit to the new court
      await supabase
        .from("court_units" as any)
        .update({ court_id: courtId } as any)
        .eq("id", unit.id);

      navigate(`/admin/court/${courtId}`);
    } catch (err: any) {
      toast.error("Failed to initialize court: " + err.message);
    } finally {
      setCreatingCourtNum(null);
    }
  };

  const showWizard = !setupCompleted || showEditSetup;

  // Locked court numbers for setup wizard
  const lockedCourtNumbers = new Set<number>();
  courtTypeUnits.forEach((u) => {
    if (u.court_id && (courtMatchCounts.get(u.court_id) || 0) > 0 && u.court_number) {
      lockedCourtNumbers.add(u.court_number);
    }
  });

  return (
    <PageLayout>
      <GlobalHeader />
      <AdminContextBanner />
      <div className="min-h-screen px-6 py-8">
        <div className="mx-auto max-w-2xl">
          {/* Header */}
          <div className="mb-2 flex items-center gap-4">
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

          {/* Session Summary Strip */}
          {setupCompleted && !showWizard && (
            <div className="mb-8">
              <SessionSummaryStrip
                totalCourts={courtCount}
                groupCount={sortedGroups.length}
                activeCount={activeCount}
                liveCount={liveCount}
              />
            </div>
          )}

          {showWizard ? (
            <SetupWizard
              cityId={selectedCityId}
              eventId={selectedEventId!}
              locationId={selectedLocationId}
              scopeEventType={scopeEventType!}
              existingConfigId={sessionConfig?.id}
              existingCourtCount={sessionConfig?.court_count}
              lockedCourtIds={lockedCourtNumbers}
              onComplete={handleSetupComplete}
            />
          ) : (
            <>
              {/* Courts & Groups Grid — derived from court_units */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {/* 1. Ungrouped courts (ascending) */}
                {ungroupedUnits.map((unit) => {
                  const status = getUnitStatus(unit);
                  return (
                    <CourtStatusCard
                      key={`court-${unit.id}`}
                      label={unit.display_name}
                      to={unit.court_id ? `/admin/court/${unit.court_id}` : undefined}
                      onClick={!unit.court_id ? () => handleCourtClick(unit) : undefined}
                      isLoading={creatingCourtNum === unit.court_number}
                      status={status}
                    />
                  );
                })}

                {/* 2. Groups (sorted by lowest court number) */}
                {sortedGroups.map((group) => {
                  const status = getGroupStatus(group);
                  return (
                    <CourtStatusCard
                      key={`group-${group.id}`}
                      label={group.display_name}
                      status={status}
                      disabled
                      disabledLabel="Coming soon"
                    />
                  );
                })}

                {ungroupedUnits.length === 0 && sortedGroups.length === 0 && (
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

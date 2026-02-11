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
import SessionSummaryStrip from "@/components/admin/SessionSummaryStrip";
import CourtStatusCard, { type CourtStatus } from "@/components/admin/CourtStatusCard";
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

interface CourtRecord {
  id: number;
  name: string;
  event_id: string | null;
  location_id: string | null;
  format_type: string;
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

  // 1. Fetch session config
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

  // 2. Fetch court groups
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

  // 3. Fetch DB court records for routing and status
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
      return (data || []) as CourtRecord[];
    },
    enabled: isContextValid && !!sessionConfig?.setup_completed,
  });

  // 4. Fetch court_state for all courts in context
  const courtIds = courts.map((c) => c.id);
  const { data: courtStates = [] } = useQuery({
    queryKey: ["court_states_dashboard", courtIds.join(",")],
    queryFn: async () => {
      if (courtIds.length === 0) return [];
      const { data, error } = await supabase
        .from("court_state")
        .select("court_id, phase")
        .in("court_id", courtIds);
      if (error) return [];
      return (data || []) as CourtState[];
    },
    enabled: courtIds.length > 0,
  });

  // 5. Fetch match counts per court
  const { data: courtMatchCounts = new Map<number, number>() } = useQuery({
    queryKey: ["court_match_counts", courtIds.join(",")],
    queryFn: async () => {
      if (courtIds.length === 0) return new Map<number, number>();
      const { data, error } = await supabase
        .from("matches")
        .select("court_id")
        .in("court_id", courtIds);
      if (error) return new Map<number, number>();
      const counts = new Map<number, number>();
      (data || []).forEach((m) => {
        counts.set(m.court_id, (counts.get(m.court_id) || 0) + 1);
      });
      return counts;
    },
    enabled: courtIds.length > 0,
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

  // === DERIVE DISPLAY FROM court_count (1..N) ===
  const allCourtNumbers = Array.from({ length: courtCount }, (_, i) => i + 1);

  // Map DB court records: courtNumber → DB court
  const courtsByNumber = new Map<number, CourtRecord>();
  courts.forEach((c) => {
    const num = parseInt(c.name.replace("Court ", ""));
    if (!isNaN(num)) courtsByNumber.set(num, c);
  });

  // Map DB court IDs to court numbers (for group resolution)
  const courtIdToNumber = new Map<number, number>();
  courts.forEach((c) => {
    const num = parseInt(c.name.replace("Court ", ""));
    if (!isNaN(num)) courtIdToNumber.set(c.id, num);
  });

  // Determine grouped court numbers from court_groups (which use DB IDs)
  const groupedCourtNumbers = new Set<number>();
  courtGroups.forEach((g) => {
    g.court_ids.forEach((dbId) => {
      const num = courtIdToNumber.get(dbId);
      if (num !== undefined) groupedCourtNumbers.add(num);
    });
  });

  // Ungrouped courts = all court numbers minus grouped
  const ungroupedCourtNumbers = allCourtNumbers.filter((n) => !groupedCourtNumbers.has(n));

  // === STATUS HELPERS ===
  const getCourtStatus = (courtNum: number): CourtStatus => {
    const dbCourt = courtsByNumber.get(courtNum);
    if (!dbCourt) return "setup";
    const matchCount = courtMatchCounts.get(dbCourt.id) || 0;
    if (matchCount === 0) return "setup";
    const state = courtStates.find((s) => s.court_id === dbCourt.id);
    if (state?.phase === "completed") return "completed";
    if (state?.phase === "in_progress") return "live";
    return "locked";
  };

  const getGroupStatus = (courtNums: number[]): CourtStatus => {
    const statuses = courtNums.map(getCourtStatus);
    if (statuses.includes("live")) return "live";
    if (statuses.includes("completed")) return "completed";
    if (statuses.includes("locked")) return "locked";
    return "setup";
  };

  // === BUILD DISPLAY ITEMS ===
  // Groups sorted by lowest court number
  const sortedGroups = [...courtGroups]
    .map((g) => {
      const courtNums = g.court_ids
        .map((dbId) => courtIdToNumber.get(dbId))
        .filter((n): n is number => n !== undefined)
        .sort((a, b) => a - b);
      return { ...g, courtNums };
    })
    .sort((a, b) => (a.courtNums[0] || 0) - (b.courtNums[0] || 0));

  // === SUMMARY COUNTS ===
  const allUnitStatuses: CourtStatus[] = [
    ...ungroupedCourtNumbers.map(getCourtStatus),
    ...sortedGroups.map((g) => getGroupStatus(g.courtNums)),
  ];
  const activeCount = allUnitStatuses.filter((s) => s !== "setup").length;
  const liveCount = allUnitStatuses.filter((s) => s === "live").length;

  const handleSetupComplete = () => {
    setShowEditSetup(false);
  };

  const showWizard = !setupCompleted || showEditSetup;

  // Locked court numbers for setup wizard
  const lockedCourtNumbers = new Set<number>();
  courts.forEach((c) => {
    if ((courtMatchCounts.get(c.id) || 0) > 0) {
      const num = parseInt(c.name.replace("Court ", ""));
      if (!isNaN(num)) lockedCourtNumbers.add(num);
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
                groupCount={courtGroups.length}
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
              existingConfigId={sessionConfig?.id}
              existingCourtCount={sessionConfig?.court_count}
              lockedCourtIds={lockedCourtNumbers}
              onComplete={handleSetupComplete}
            />
          ) : (
            <>
              {/* Courts & Groups Grid — derived from court_count */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
                {/* 1. Ungrouped courts (ascending) */}
                {ungroupedCourtNumbers.map((courtNum) => {
                  const dbCourt = courtsByNumber.get(courtNum);
                  const status = getCourtStatus(courtNum);
                  return (
                    <CourtStatusCard
                      key={`court-${courtNum}`}
                      label={`Court ${courtNum}`}
                      to={dbCourt ? `/admin/court/${dbCourt.id}` : undefined}
                      status={status}
                      disabled={!dbCourt}
                      disabledLabel={!dbCourt ? "Not configured" : undefined}
                    />
                  );
                })}

                {/* 2. Groups (sorted by lowest court number) */}
                {sortedGroups.map((g) => {
                  const nums = g.courtNums;
                  let label: string;
                  if (nums.length === 2) {
                    label = `Courts ${nums[0]} & ${nums[1]}`;
                  } else if (nums.length > 2) {
                    const last = nums[nums.length - 1];
                    const rest = nums.slice(0, -1);
                    label = `Courts ${rest.join(", ")} & ${last}`;
                  } else {
                    label = `Court ${nums[0] || "?"}`;
                  }
                  const status = getGroupStatus(nums);
                  return (
                    <CourtStatusCard
                      key={`group-${g.id}`}
                      label={label}
                      status={status}
                      disabled
                      disabledLabel="Coming soon"
                    />
                  );
                })}

                {allCourtNumbers.length === 0 && (
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

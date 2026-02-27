import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Settings } from "lucide-react";
import AdminManagement from "@/components/admin/AdminManagement";
import { toast } from "sonner";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import AdminContextBanner from "@/components/admin/AdminContextBanner";
import SetupWizard from "@/components/admin/SetupWizard";
import SessionSummaryStrip from "@/components/admin/SessionSummaryStrip";
import SessionLifecycleControls from "@/components/admin/SessionLifecycleControls";
import CourtStatusCard, { type CourtStatus } from "@/components/admin/CourtStatusCard";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useEventContext } from "@/hooks/useEventContext";
import { useScopedCourts, type RenderItem } from "@/hooks/useScopedCourts";
import { useActiveSession } from "@/hooks/useActiveSession";

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { isAdmin, isLoading, signOut, user } = useAdminAuth();
  const {
    selectedCityId,
    selectedEventId,
    selectedLocationId,
    isContextValid,
    clearSelection,
    scopeEventType,
  } = useEventContext();

  const {
    sessionConfig,
    configLoading,
    courtUnits,
    courtCount,
    setupCompleted,
    renderItems,
    warnings,
  } = useScopedCourts();

  const { isLive, isEnded, activeSession } = useActiveSession();

  const [showEditSetup, setShowEditSetup] = useState(false);
  const [creatingCourtNum, setCreatingCourtNum] = useState<number | null>(null);
  const [creatingGroupId, setCreatingGroupId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !isAdmin) navigate("/admin/login");
  }, [isLoading, isAdmin, navigate]);

  useEffect(() => {
    if (!isLoading && isAdmin && !isContextValid) navigate("/", { replace: true });
  }, [isLoading, isAdmin, isContextValid, navigate]);

  // Log warnings for admins
  useEffect(() => {
    warnings.forEach((w) => toast.warning(w));
  }, [warnings]);

  const handleLogout = async () => {
    await signOut();
    clearSelection();
    navigate("/");
  };

  const handleBackToHome = () => {
    clearSelection();
    navigate("/");
  };

  // ── Linked court IDs for status queries ──
  const linkedCourtIds = courtUnits
    .filter((u: any) => u.court_id != null)
    .map((u: any) => u.court_id!);

  // Fetch court_state
  const { data: courtStates = [] } = useQuery({
    queryKey: ["court_states_dashboard", linkedCourtIds.join(",")],
    queryFn: async () => {
      if (linkedCourtIds.length === 0) return [];
      const { data, error } = await supabase
        .from("court_state")
        .select("court_id, phase")
        .in("court_id", linkedCourtIds);
      if (error) return [];
      return (data || []) as { court_id: number; phase: "idle" | "in_progress" | "completed" }[];
    },
    enabled: linkedCourtIds.length > 0,
  });

  // Fetch match counts
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
      (data || []).forEach((m) => counts.set(m.court_id, (counts.get(m.court_id) || 0) + 1));
      return counts;
    },
    enabled: linkedCourtIds.length > 0,
  });

  // Fetch fairness scores
  const { data: fairnessScores = new Map<number, number>() } = useQuery({
    queryKey: ["rotation_audit_scores", linkedCourtIds.join(",")],
    queryFn: async () => {
      if (linkedCourtIds.length === 0) return new Map<number, number>();
      const { data, error } = await supabase
        .from("rotation_audit" as any)
        .select("court_id, fairness_score")
        .in("court_id", linkedCourtIds);
      if (error) return new Map<number, number>();
      const scores = new Map<number, number>();
      (data || []).forEach((r: any) => scores.set(r.court_id, Number(r.fairness_score)));
      return scores;
    },
    enabled: linkedCourtIds.length > 0,
  });

  // Fetch group-level status data (players + matches per group for this session)
  const currentSessionId = activeSession?.id || null;
  const { data: groupStatusMap = new Map<string, { playerCount: number; matchCount: number; hasLive: boolean }>() } = useQuery({
    queryKey: ["group_status_dashboard", sessionConfig?.id, currentSessionId],
    queryFn: async () => {
      const { data: groups } = await supabase
        .from("court_groups")
        .select("id, court_ids, session_id, is_locked")
        .eq("session_config_id", sessionConfig!.id);

      const result = new Map<string, { playerCount: number; matchCount: number; hasLive: boolean }>();
      if (!groups) return result;

      for (const g of groups) {
        // Only count groups for current session or no session
        if (g.session_id && currentSessionId && g.session_id !== currentSessionId) continue;

        let playerQuery = supabase.from("players").select("id", { count: "exact", head: true }).eq("group_id", g.id);
        if (currentSessionId) playerQuery = playerQuery.eq("session_id", currentSessionId);
        const { count: pCount } = await playerQuery;

        let matchQuery = supabase.from("matches").select("id, status").eq("group_id", g.id);
        if (currentSessionId) matchQuery = matchQuery.eq("session_id", currentSessionId);
        const { data: matchData } = await matchQuery;

        const matchCount = matchData?.length || 0;
        const hasLive = (matchData || []).some(m => m.status === "in_progress");

        // Map by court_ids array key for lookup
        const key = [...(g.court_ids || [])].sort((a, b) => a - b).join(",");
        result.set(key, { playerCount: pCount || 0, matchCount, hasLive });
      }

      return result;
    },
    enabled: !!sessionConfig?.id,
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

  if (!isAdmin || !isContextValid) return null;

  // ── Status helpers ──
  const getItemStatus = (item: RenderItem): CourtStatus => {
    if (item.type === "group") {
      const key = [...(item.courtNumbers || [])].sort((a, b) => a - b).join(",");
      const status = groupStatusMap.get(key);
      if (!status) return "setup";
      if (status.hasLive) return "live";
      if (status.matchCount > 0) return "locked";
      if (status.playerCount > 0) return "locked"; // "Players added" state
      return "setup";
    }
    // Find the court_unit for this item
    const unit = courtUnits.find((u: any) => u.id === item.unitId);
    if (!unit) return "setup";
    return getCourtUnitStatus(unit);
  };

  const getCourtUnitStatus = (unit: any): CourtStatus => {
    if (!unit.court_id) return "setup";
    const matchCount = courtMatchCounts.get(unit.court_id) || 0;
    if (matchCount === 0) return "setup";
    const state = courtStates.find((s) => s.court_id === unit.court_id);
    if (state?.phase === "completed") return "completed";
    if (state?.phase === "in_progress") return "live";
    return "locked";
  };

  // ── Summary counts ──
  const allStatuses = renderItems.map(getItemStatus);
  const activeCount = allStatuses.filter((s) => s !== "setup").length;
  const liveCount = allStatuses.filter((s) => s === "live").length;

  const handleSetupComplete = () => setShowEditSetup(false);

  // Auto-create court row on click
  const handleCourtClick = async (item: RenderItem) => {
    if (!item.courtNumber) return;
    setCreatingCourtNum(item.courtNumber);
    try {
      const { data, error } = await supabase
        .from("courts")
        .insert({
          name: `Court ${item.courtNumber}`,
          event_id: selectedEventId,
          location_id: selectedLocationId || null,
          format_type: (item.formatType || "mystery_partner") as any,
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      const courtId = (data as any).id;

      await supabase.from("court_state").insert({ court_id: courtId } as any);
      await supabase
        .from("court_units" as any)
        .update({ court_id: courtId } as any)
        .eq("id", item.unitId);

      navigate(`/admin/court/${courtId}`);
    } catch (err: any) {
      toast.error("Failed to initialize court: " + err.message);
    } finally {
      setCreatingCourtNum(null);
    }
  };

  // Auto-create court_groups row on group click
  const handleGroupClick = async (item: RenderItem) => {
    if (!item.unitId || !item.courtNumbers) return;
    setCreatingGroupId(item.unitId);
    try {
      const currentSessionId = activeSession?.id || null;
      const sortedNums = [...item.courtNumbers].sort((a, b) => a - b);

      // Find existing group matching session_config + court_ids + current session
      const { data: allGroups } = await supabase
        .from("court_groups")
        .select("id, court_ids, session_id")
        .eq("session_config_id", sessionConfig?.id || "");

      // Match by court_ids array AND session_id
      const existing = (allGroups || []).find(g => {
        const gNums = [...(g.court_ids || [])].sort((a, b) => a - b);
        const idsMatch = JSON.stringify(gNums) === JSON.stringify(sortedNums);
        // Prefer group with matching session_id, then null session_id
        return idsMatch && (g.session_id === currentSessionId || g.session_id === null);
      });

      // Also check for exact session match (higher priority)
      const exactSessionMatch = (allGroups || []).find(g => {
        const gNums = [...(g.court_ids || [])].sort((a, b) => a - b);
        return JSON.stringify(gNums) === JSON.stringify(sortedNums) && g.session_id === currentSessionId;
      });

      if (exactSessionMatch) {
        navigate(`/admin/group/${exactSessionMatch.id}`);
        return;
      }

      if (existing && existing.session_id === null && currentSessionId) {
        // Update existing group with current session_id
        await supabase.from("court_groups").update({ session_id: currentSessionId } as any).eq("id", existing.id);
        navigate(`/admin/group/${existing.id}`);
        return;
      }

      if (existing) {
        navigate(`/admin/group/${existing.id}`);
        return;
      }

      // Create new court_groups row
      const { data, error } = await supabase
        .from("court_groups")
        .insert({
          court_ids: item.courtNumbers,
          session_config_id: sessionConfig!.id,
          session_id: currentSessionId,
          format_type: "mystery_partner",
        } as any)
        .select("id")
        .single();
      if (error) throw error;
      navigate(`/admin/group/${(data as any).id}`);
    } catch (err: any) {
      toast.error("Failed to initialize group: " + err.message);
    } finally {
      setCreatingGroupId(null);
    }
  };

  const showWizard = !setupCompleted || showEditSetup;

  // Locked court numbers for setup wizard
  const lockedCourtNumbers = new Set<number>();
  courtUnits.forEach((u: any) => {
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

          {/* Session Lifecycle Controls */}
          {setupCompleted && !showWizard && (
            <div className="mb-4">
              <SessionLifecycleControls setupCompleted={setupCompleted} />
            </div>
          )}

          {/* Session Summary Strip */}
          {setupCompleted && !showWizard && (
            <div className="mb-8">
              <SessionSummaryStrip
                totalCourts={courtCount}
                groupCount={renderItems.filter((i) => i.type === "group").length}
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {renderItems.map((item) => {
                const status = getItemStatus(item);
                const score =
                  item.type === "court" && item.courtId
                    ? fairnessScores.get(item.courtId) ?? null
                    : null;

                  if (item.type === "group") {
                    return (
                      <CourtStatusCard
                        key={item.key}
                        label={item.label}
                        onClick={() => handleGroupClick(item)}
                        isLoading={creatingGroupId === item.unitId}
                        status={status}
                      />
                    );
                  }

                return (
                  <CourtStatusCard
                    key={item.key}
                    label={item.label}
                    to={item.courtId ? `/admin/court/${item.courtId}` : undefined}
                    onClick={!item.courtId ? () => handleCourtClick(item) : undefined}
                    isLoading={creatingCourtNum === item.courtNumber}
                    status={status}
                    fairnessScore={score}
                  />
                );
              })}

              {renderItems.length === 0 && (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                  No courts configured yet.
                </div>
              )}
            </div>
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

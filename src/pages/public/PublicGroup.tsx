import { useEffect, useMemo } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import GroupCourtPulse from "@/components/public/GroupCourtPulse";
import PersonalRoster from "@/components/public/PersonalRoster";
import Leaderboard from "@/components/public/Leaderboard";
import { useEventContext, GOOSEPICK_THURSDAYS_ID } from "@/hooks/useEventContext";
import { useActiveSession } from "@/hooks/useActiveSession";
import { format } from "date-fns";

const PublicGroup = () => {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isContextValid, isLoading: contextLoading } = useEventContext();
  const { sessionLoading, sessionId } = useActiveSession();

  // Redirect if no context
  useEffect(() => {
    if (!contextLoading && !isContextValid) {
      navigate("/", { replace: true });
    }
  }, [contextLoading, isContextValid, navigate]);

  // Fetch group details — resolve the URL group to the equivalent group in the active session.
  // IMPORTANT: all dependent reads must use group.id (the resolved id), not the stale URL id.
  const { data: group, isLoading: groupLoading } = useQuery({
    queryKey: ["court_group", groupId, sessionId],
    queryFn: async () => {
      const { data: urlGroup, error } = await supabase
        .from("court_groups")
        .select("*")
        .eq("id", groupId!)
        .maybeSingle();
      if (error) throw error;
      if (!urlGroup) return null;

      // No session resolved yet: keep the URL group only while session resolution is unavailable.
      if (!sessionId) return urlGroup;

      // If the URL already points at the active-session group, use it directly.
      if (urlGroup.session_id === sessionId) return urlGroup;

      // Otherwise find the equivalent group in the active session.
      const { data: sessionGroups, error: sessionGroupsError } = await supabase
        .from("court_groups")
        .select("*")
        .eq("session_config_id", urlGroup.session_config_id)
        .eq("session_id", sessionId);
      if (sessionGroupsError) throw sessionGroupsError;

      const sourceCourtIds = [...(urlGroup.court_ids || [])].sort((a: number, b: number) => a - b);
      const match = sessionGroups?.find((candidate: any) => {
        const candidateCourtIds = [...(candidate.court_ids || [])].sort((a: number, b: number) => a - b);
        return JSON.stringify(candidateCourtIds) === JSON.stringify(sourceCourtIds);
      });

      // Never fall back to a group from another session. That is how stale/empty public rosters leaked in.
      return match || null;
    },
    enabled: !!groupId && isContextValid && !sessionLoading,
  });

  const resolvedGroupId = group?.id ?? null;

  // Fetch players scoped to the RESOLVED group and session.
  const { data: players = [] } = useQuery({
    queryKey: ["group_players", resolvedGroupId, sessionId],
    queryFn: async () => {
      let query = supabase
        .from("players")
        .select("*")
        .eq("group_id", resolvedGroupId!)
        .order("created_at", { ascending: true });
      if (sessionId) query = query.eq("session_id", sessionId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedGroupId && isContextValid,
  });

  // Fetch matches scoped to the RESOLVED group and session.
  const { data: matches = [] } = useQuery({
    queryKey: ["group_matches", resolvedGroupId, sessionId],
    queryFn: async () => {
      let query = supabase
        .from("matches")
        .select("*")
        .eq("group_id", resolvedGroupId!)
        .order("global_match_index", { ascending: true });
      if (sessionId) query = query.eq("session_id", sessionId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedGroupId && isContextValid,
  });

  // Fetch group court states scoped to the RESOLVED group and session.
  const { data: courtStates = [] } = useQuery({
    queryKey: ["group_court_state", resolvedGroupId, sessionId],
    queryFn: async () => {
      let query = supabase
        .from("group_court_state")
        .select("*")
        .eq("group_id", resolvedGroupId!)
        .order("court_number", { ascending: true });
      if (sessionId) query = query.eq("session_id", sessionId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedGroupId && isContextValid,
  });

  // Build a synthetic court_id and courtState for PersonalRoster compatibility
  // PersonalRoster expects a courtId (number) and courtState. We use court_ids[0] as sentinel.
  const syntheticCourtId = group?.court_ids?.[0] ?? 0;

  // Build a synthetic courtState from group court states for PersonalRoster nudge logic
  const syntheticCourtState = useMemo(() => {
    if (courtStates.length === 0) return undefined;
    const liveState = courtStates.find(cs => cs.is_live);
    const currentGlobalIndex = liveState?.current_match_global_index ?? 0;
    const anyLive = courtStates.some(cs => cs.is_live);
    const allMatchesDone = matches.length > 0 && matches.every(m => m.status === "completed");

    const N = group?.court_ids?.length || 1;
    const currentRound = currentGlobalIndex > 0
      ? Math.floor((currentGlobalIndex - 1) / N)
      : 0;

    return {
      id: `synthetic-${resolvedGroupId ?? "group"}`,
      court_id: syntheticCourtId,
      current_match_index: currentRound,
      phase: allMatchesDone ? "completed" as const : anyLive ? "in_progress" as const : "idle" as const,
      session_id: group?.session_id ?? null,
      updated_at: new Date().toISOString(),
    };
  }, [courtStates, matches, syntheticCourtId, group?.session_id, group?.court_ids?.length]);

  // Realtime subscriptions must also follow the resolved active-session group id.
  useEffect(() => {
    if (!resolvedGroupId || !isContextValid) return;

    const channel = supabase
      .channel(`group-${resolvedGroupId}-${sessionId || "no-session"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_court_state", filter: `group_id=eq.${resolvedGroupId}` },
        () => queryClient.invalidateQueries({ queryKey: ["group_court_state", resolvedGroupId, sessionId] })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `group_id=eq.${resolvedGroupId}` },
        () => queryClient.invalidateQueries({ queryKey: ["group_matches", resolvedGroupId, sessionId] })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `group_id=eq.${resolvedGroupId}` },
        () => queryClient.invalidateQueries({ queryKey: ["group_players", resolvedGroupId, sessionId] })
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [resolvedGroupId, queryClient, isContextValid, sessionId]);

  // Fetch court_units to get display court numbers for this resolved group
  const { data: groupCourtUnit } = useQuery({
    queryKey: ["court_unit_for_group", resolvedGroupId],
    queryFn: async () => {
      const { data } = await supabase
        .from("court_units" as any)
        .select("group_court_numbers")
        .eq("court_group_id", resolvedGroupId!)
        .maybeSingle();
      return data as unknown as { group_court_numbers: number[] | null } | null;
    },
    enabled: !!resolvedGroupId,
  });

  // Derive display name from court_units group_court_numbers (display numbers), not court_groups.court_ids (DB PKs)
  const groupLabel = useMemo(() => {
    const nums = groupCourtUnit?.group_court_numbers || group?.court_ids;
    if (!nums || nums.length === 0) return "Group";
    if (nums.length === 1) return `Court ${nums[0]}`;
    if (nums.length === 2) return `Courts ${nums[0]} & ${nums[1]}`;
    const last = nums[nums.length - 1];
    const rest = nums.slice(0, -1);
    return `Courts ${rest.join(", ")} & ${last}`;
  }, [groupCourtUnit?.group_court_numbers, group?.court_ids]);

  if (contextLoading || sessionLoading || groupLoading) {
    return (
      <PageLayout showFooter={false}>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </PageLayout>
    );
  }

  if (!group) {
    return (
      <PageLayout showFooter={false}>
        <GlobalHeader />
        <div className="flex min-h-screen items-center justify-center flex-col gap-4">
          <div className="text-muted-foreground">This group is not available for the current session.</div>
          <Button asChild variant="outline"><Link to="/public">Back to Court Selection</Link></Button>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout showFooter={false}>
      <div className="min-h-screen flex flex-col">
        <GlobalHeader />

        <div className="px-4 py-3 flex items-center gap-3 border-b border-border">
          <Button asChild variant="ghost" size="icon" className="shrink-0">
            <Link to="/public">
              <ChevronLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">{groupLabel}</h1>
        </div>

        <GroupCourtPulse
          courtStates={courtStates}
          matches={matches}
          players={players}
          totalMatches={group.total_matches || matches.length}
          courtIds={group.court_ids}
        />

        <Tabs defaultValue="personal" className="flex-1 flex flex-col">
          <TabsList className="sticky top-0 z-10 mx-4 bg-secondary rounded-xl h-12">
            <TabsTrigger value="personal" className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Personal Roster
            </TabsTrigger>
            <TabsTrigger value="leaderboard" className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Leaderboard
            </TabsTrigger>
          </TabsList>

          <TabsContent value="personal" className="flex-1 mt-0 p-4">
            <PersonalRoster
              courtId={syntheticCourtId}
              players={players}
              matches={matches}
              courtState={syntheticCourtState}
              courtsInGroup={group?.court_ids?.length || 1}
              groupId={group?.id}
              courtIds={group?.court_ids}
            />
          </TabsContent>

          <TabsContent value="leaderboard" className="flex-1 mt-0 p-4">
            <Leaderboard
              matches={matches}
              players={players}
            />
          </TabsContent>
        </Tabs>

        <div className="py-4 text-center border-t border-border">
          <p className="text-xs text-muted-foreground">
            <GroupFooterText />
          </p>
        </div>
      </div>
    </PageLayout>
  );
};

const GroupFooterText = () => {
  const { selectedEvent, selectedCity, selectedLocation } = useEventContext();
  const today = format(new Date(), "MMMM d, yyyy");
  const cityName = selectedCity?.name || "Mumbai";
  const eventName = selectedEvent?.name || "Goosepick Social";
  const isThursdays = selectedEvent?.id === GOOSEPICK_THURSDAYS_ID;

  const footerText = isThursdays && selectedLocation
    ? `${eventName} ${cityName} – ${today} – ${selectedLocation.name}`
    : `${eventName} ${cityName} – ${today}`;

  return <>{footerText}</>;
};

export default PublicGroup;

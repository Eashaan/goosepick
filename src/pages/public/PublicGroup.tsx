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
  const { activeSession, sessionLoading, sessionId } = useActiveSession();

  // Redirect if no context
  useEffect(() => {
    if (!contextLoading && !isContextValid) {
      navigate("/", { replace: true });
    }
  }, [contextLoading, isContextValid, navigate]);

  // Fetch group details — validate it belongs to active session
  const { data: group, isLoading: groupLoading } = useQuery({
    queryKey: ["court_group", groupId, sessionId],
    queryFn: async () => {
      let query = supabase
        .from("court_groups")
        .select("*")
        .eq("id", groupId!);
      // Scope: group must belong to current session OR have no session
      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      // Validate the group belongs to current session scope
      if (data && sessionId && data.session_id && data.session_id !== sessionId) {
        return null; // Wrong session
      }
      return data;
    },
    enabled: !!groupId && isContextValid && !sessionLoading,
  });

  // Fetch players scoped to group AND session
  const { data: players = [] } = useQuery({
    queryKey: ["group_players", groupId, sessionId],
    queryFn: async () => {
      let query = supabase
        .from("players")
        .select("*")
        .eq("group_id", groupId!)
        .order("created_at", { ascending: true });
      if (sessionId) query = query.eq("session_id", sessionId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!groupId && !!group && isContextValid,
  });

  // Fetch matches scoped to group
  const { data: matches = [] } = useQuery({
    queryKey: ["group_matches", groupId, sessionId],
    queryFn: async () => {
      let query = supabase
        .from("matches")
        .select("*")
        .eq("group_id", groupId!)
        .order("global_match_index", { ascending: true });
      if (sessionId) query = query.eq("session_id", sessionId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!groupId && !!group && isContextValid,
  });

  // Fetch group court states
  const { data: courtStates = [] } = useQuery({
    queryKey: ["group_court_state", groupId, sessionId],
    queryFn: async () => {
      let query = supabase
        .from("group_court_state")
        .select("*")
        .eq("group_id", groupId!)
        .order("court_number", { ascending: true });
      if (sessionId) query = query.eq("session_id", sessionId);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: !!groupId && !!group && isContextValid,
  });

  // Build a synthetic court_id and courtState for PersonalRoster compatibility
  // PersonalRoster expects a courtId (number) and courtState. We use court_ids[0] as sentinel.
  const syntheticCourtId = group?.court_ids?.[0] ?? 0;

  // Build a synthetic courtState from group court states for PersonalRoster nudge logic
  const syntheticCourtState = useMemo(() => {
    if (courtStates.length === 0) return undefined;
    // Find first live court
    const liveState = courtStates.find(cs => cs.is_live);
    const currentGlobalIndex = liveState?.current_match_global_index ?? 0;
    const anyLive = courtStates.some(cs => cs.is_live);
    const allMatchesDone = matches.length > 0 && matches.every(m => m.status === "completed");

    // Convert global index to 0-based round number
    const N = group?.court_ids?.length || 1;
    const currentRound = currentGlobalIndex > 0
      ? Math.floor((currentGlobalIndex - 1) / N)
      : 0;

    return {
      court_id: syntheticCourtId,
      current_match_index: currentRound,
      phase: allMatchesDone ? "completed" as const : anyLive ? "in_progress" as const : "idle" as const,
      session_id: group?.session_id ?? null,
      updated_at: new Date().toISOString(),
    };
  }, [courtStates, matches, syntheticCourtId, group?.session_id, group?.court_ids?.length]);

  // Realtime subscriptions
  useEffect(() => {
    if (!groupId || !isContextValid) return;

    const channel = supabase
      .channel(`group-${groupId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_court_state", filter: `group_id=eq.${groupId}` },
        () => queryClient.invalidateQueries({ queryKey: ["group_court_state", groupId, sessionId] })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `group_id=eq.${groupId}` },
        () => queryClient.invalidateQueries({ queryKey: ["group_matches", groupId, sessionId] })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `group_id=eq.${groupId}` },
        () => queryClient.invalidateQueries({ queryKey: ["group_players", groupId, sessionId] })
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [groupId, queryClient, isContextValid, sessionId]);

  // Derive display name from court numbers
  const groupLabel = useMemo(() => {
    if (!group?.court_ids || group.court_ids.length === 0) return "Group";
    return `Courts ${group.court_ids.join(" & ")}`;
  }, [group?.court_ids]);

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

        {/* Group Title */}
        <div className="px-4 py-3 flex items-center gap-3 border-b border-border">
          <Button asChild variant="ghost" size="icon" className="shrink-0">
            <Link to="/public">
              <ChevronLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">{groupLabel}</h1>
        </div>

        {/* Multi-Court Pulse */}
        <GroupCourtPulse
          courtStates={courtStates}
          matches={matches}
          players={players}
          totalMatches={group.total_matches || matches.length}
          courtIds={group.court_ids}
        />

        {/* Tabs */}
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
            />
          </TabsContent>

          <TabsContent value="leaderboard" className="flex-1 mt-0 p-4">
            <Leaderboard
              matches={matches}
              players={players}
            />
          </TabsContent>
        </Tabs>

        {/* Footer */}
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

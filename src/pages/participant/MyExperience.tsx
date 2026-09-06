import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import CourtPulse from "@/components/public/CourtPulse";
import GroupCourtPulse from "@/components/public/GroupCourtPulse";
import PersonalRoster from "@/components/public/PersonalRoster";
import Leaderboard from "@/components/public/Leaderboard";

const MyExperience = () => {
  const { registrationId } = useParams();
  const queryClient = useQueryClient();

  // RLS on experience_registrations is the ownership boundary. A registration
  // not belonging to this authenticated participant/purchaser resolves to null.
  const { data: registration, isLoading: registrationLoading } = useQuery({
    queryKey: ["my-registration", registrationId],
    enabled: Boolean(registrationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("experience_registrations")
        .select(
          `id, session_id, status, seat_index, participant_name,
           sessions:sessions ( id, date, status, event_type, session_label, cities ( name ), locations ( name ) )`,
        )
        .eq("id", registrationId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: linkedPlayer, isLoading: playerLoading } = useQuery({
    queryKey: ["my-registration-player", registrationId],
    enabled: Boolean(registration?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("registration_id", registration!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const sessionId = registration?.session_id ?? null;
  const courtId = linkedPlayer?.court_id ?? null;
  const groupId = linkedPlayer?.group_id ?? null;

  const { data: courtPlayers = [] } = useQuery({
    queryKey: ["my-court-players", courtId, sessionId],
    enabled: Boolean(courtId && sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("court_id", courtId!)
        .eq("session_id", sessionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: courtMatches = [] } = useQuery({
    queryKey: ["my-court-matches", courtId, sessionId],
    enabled: Boolean(courtId && sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("court_id", courtId!)
        .eq("session_id", sessionId!)
        .order("match_index", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: courtState } = useQuery({
    queryKey: ["my-court-state", courtId, sessionId],
    enabled: Boolean(courtId && sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("court_state")
        .select("*")
        .eq("court_id", courtId!)
        .eq("session_id", sessionId!)
        .maybeSingle();
      if (error) throw error;
      return data ?? undefined;
    },
  });

  const { data: courtDetails } = useQuery({
    queryKey: ["my-court-details", courtId],
    enabled: Boolean(courtId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courts")
        .select("id, name")
        .eq("id", courtId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: group } = useQuery({
    queryKey: ["my-group", groupId, sessionId],
    enabled: Boolean(groupId && sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("court_groups")
        .select("*")
        .eq("id", groupId!)
        .eq("session_id", sessionId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: groupPlayers = [] } = useQuery({
    queryKey: ["my-group-players", groupId, sessionId],
    enabled: Boolean(groupId && sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("group_id", groupId!)
        .eq("session_id", sessionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: groupMatches = [] } = useQuery({
    queryKey: ["my-group-matches", groupId, sessionId],
    enabled: Boolean(groupId && sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("group_id", groupId!)
        .eq("session_id", sessionId!)
        .order("global_match_index", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: groupCourtStates = [] } = useQuery({
    queryKey: ["my-group-court-state", groupId, sessionId],
    enabled: Boolean(groupId && sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("group_court_state")
        .select("*")
        .eq("group_id", groupId!)
        .eq("session_id", sessionId!)
        .order("court_number", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: groupCourtUnit } = useQuery({
    queryKey: ["my-group-court-unit", groupId, sessionId],
    enabled: Boolean(groupId && sessionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("court_units")
        .select("group_court_numbers")
        .eq("court_group_id", groupId!)
        .eq("session_id", sessionId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const syntheticGroupCourtState = useMemo(() => {
    if (!groupId || !sessionId || groupCourtStates.length === 0) return undefined;
    const liveState = groupCourtStates.find((state) => state.is_live);
    const currentGlobalIndex = liveState?.current_match_global_index ?? 0;
    const courtCount = group?.court_ids?.length || 1;
    const currentRound = currentGlobalIndex > 0 ? Math.floor((currentGlobalIndex - 1) / courtCount) : 0;
    const allCompleted = groupMatches.length > 0 && groupMatches.every((match) => match.status === "completed");

    return {
      id: `my-${groupId}`,
      court_id: group?.court_ids?.[0] ?? 0,
      current_match_index: currentRound,
      phase: allCompleted ? "completed" : liveState ? "in_progress" : "idle",
      session_id: sessionId,
      updated_at: new Date().toISOString(),
    } as const;
  }, [groupId, sessionId, groupCourtStates, groupMatches, group?.court_ids]);

  useEffect(() => {
    if (!sessionId || (!courtId && !groupId)) return;
    const channel = supabase
      .channel(`my-experience-${registrationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `session_id=eq.${sessionId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["my-registration-player", registrationId] });
        queryClient.invalidateQueries({ queryKey: ["my-court-players", courtId, sessionId] });
        queryClient.invalidateQueries({ queryKey: ["my-group-players", groupId, sessionId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "matches", filter: `session_id=eq.${sessionId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["my-court-matches", courtId, sessionId] });
        queryClient.invalidateQueries({ queryKey: ["my-group-matches", groupId, sessionId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "court_state", filter: `session_id=eq.${sessionId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["my-court-state", courtId, sessionId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "group_court_state", filter: `session_id=eq.${sessionId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["my-group-court-state", groupId, sessionId] });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [registrationId, sessionId, courtId, groupId, queryClient]);

  if (registrationLoading || playerLoading) {
    return <StatusShell title="Loading your experience..." />;
  }

  if (!registration) {
    return <StatusShell title="Experience not found" body="This registration is not available to your account." />;
  }

  if (["cancelled", "refunded"].includes(registration.status)) {
    return (
      <StatusShell
        title={registration.status === "refunded" ? "This booking was refunded" : "This booking was cancelled"}
        body="It is no longer part of an active Goosepick roster."
      />
    );
  }

  if (!linkedPlayer || !sessionId) {
    return (
      <StatusShell
        title="Your spot is confirmed."
        body="Roster coming soon. Once your court is assigned, your personal schedule will appear here automatically."
      />
    );
  }

  if (courtId) {
    return (
      <RosterShell title={courtDetails?.name || "Your Court"}>
        <CourtPulse courtState={courtState} matches={courtMatches} players={courtPlayers} totalMatches={courtMatches.length || 17} />
        <RosterTabs>
          <PersonalRoster courtId={courtId} players={courtPlayers} matches={courtMatches} courtState={courtState} lockedPlayerId={linkedPlayer.id} />
          <Leaderboard matches={courtMatches} players={courtPlayers} />
        </RosterTabs>
      </RosterShell>
    );
  }

  if (groupId && group) {
    const displayCourts = groupCourtUnit?.group_court_numbers || group.court_ids.map((_: number, index: number) => index + 1);
    const syntheticCourtId = group.court_ids?.[0] ?? 0;
    const title = displayCourts.length > 1 ? `Courts ${displayCourts.join(" & ")}` : `Court ${displayCourts[0] || ""}`;

    return (
      <RosterShell title={title}>
        <GroupCourtPulse
          courtStates={groupCourtStates}
          matches={groupMatches}
          players={groupPlayers}
          totalMatches={group.total_matches || groupMatches.length}
          courtIds={displayCourts}
        />
        <RosterTabs>
          <PersonalRoster
            courtId={syntheticCourtId}
            players={groupPlayers}
            matches={groupMatches}
            courtState={syntheticGroupCourtState as any}
            courtsInGroup={displayCourts.length}
            groupId={groupId}
            courtIds={displayCourts}
            lockedPlayerId={linkedPlayer.id}
          />
          <Leaderboard matches={groupMatches} players={groupPlayers} />
        </RosterTabs>
      </RosterShell>
    );
  }

  return <StatusShell title="Your spot is confirmed." body="Your court assignment is still being prepared." />;
};

const StatusShell = ({ title, body }: { title: string; body?: string }) => (
  <PageLayout>
    <GlobalHeader />
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-2xl font-bold text-foreground">{title}</h1>
      {body && <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>}
      <Button asChild variant="outline" className="mt-6 h-12 rounded-xl">
        <Link to="/my">Back to My Goosepick</Link>
      </Button>
    </div>
  </PageLayout>
);

const RosterShell = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <PageLayout showFooter={false}>
    <div className="min-h-screen flex flex-col">
      <GlobalHeader />
      <div className="px-4 py-3 flex items-center gap-3 border-b border-border">
        <Button asChild variant="ghost" size="icon" className="shrink-0">
          <Link to="/my"><ChevronLeft className="h-5 w-5" /></Link>
        </Button>
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">My Goosepick</p>
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
      </div>
      {children}
    </div>
  </PageLayout>
);

const RosterTabs = ({ children }: { children: [React.ReactNode, React.ReactNode] }) => (
  <Tabs defaultValue="personal" className="flex-1 flex flex-col">
    <TabsList className="sticky top-0 z-10 mx-4 bg-secondary rounded-xl h-12">
      <TabsTrigger value="personal" className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Personal Roster</TabsTrigger>
      <TabsTrigger value="leaderboard" className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Leaderboard</TabsTrigger>
    </TabsList>
    <TabsContent value="personal" className="flex-1 mt-0 p-4">{children[0]}</TabsContent>
    <TabsContent value="leaderboard" className="flex-1 mt-0 p-4">{children[1]}</TabsContent>
  </Tabs>
);

export default MyExperience;

import { useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import CourtPulse from "@/components/public/CourtPulse";
import PersonalRoster from "@/components/public/PersonalRoster";
import Leaderboard from "@/components/public/Leaderboard";
import { useCourtContextGuard } from "@/hooks/useCourtContextGuard";
import { useActiveSession } from "@/hooks/useActiveSession";

const PublicCourt = () => {
  const { courtId } = useParams();
  const courtNumber = parseInt(courtId || "1");
  const queryClient = useQueryClient();
  const { isValidating } = useCourtContextGuard(courtNumber);
  const { sessionId: activeSessionId } = useActiveSession();

  // Fetch players (scoped to session)
  const { data: players = [] } = useQuery({
    queryKey: ["players", courtNumber, activeSessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("court_id", courtNumber)
        .eq("session_id", activeSessionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !isValidating && !!activeSessionId,
  });

  // Fetch matches (scoped to session)
  const { data: matches = [] } = useQuery({
    queryKey: ["matches", courtNumber, activeSessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("court_id", courtNumber)
        .eq("session_id", activeSessionId!)
        .order("match_index", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !isValidating && !!activeSessionId,
  });

  // Fetch court state (scoped to session)
  const { data: courtState } = useQuery({
    queryKey: ["court_state", courtNumber, activeSessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("court_state")
        .select("*")
        .eq("court_id", courtNumber)
        .eq("session_id", activeSessionId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !isValidating && !!activeSessionId,
  });

  // Fetch court details for display name
  const { data: courtDetails } = useQuery({
    queryKey: ["court_details", courtNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courts")
        .select("*")
        .eq("id", courtNumber)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !isValidating,
  });

  const courtName = courtDetails?.name || `Court ${courtNumber}`;

  // Set up realtime subscriptions
  useEffect(() => {
    if (isValidating) return;

    const channel = supabase
      .channel(`court-${courtNumber}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "court_state", filter: `court_id=eq.${courtNumber}` },
        () => queryClient.invalidateQueries({ queryKey: ["court_state", courtNumber] })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `court_id=eq.${courtNumber}` },
        () => queryClient.invalidateQueries({ queryKey: ["matches", courtNumber] })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `court_id=eq.${courtNumber}` },
        () => queryClient.invalidateQueries({ queryKey: ["players", courtNumber] })
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [courtNumber, queryClient, isValidating]);

  if (isValidating) {
    return (
      <PageLayout showFooter={false}>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout showFooter={false}>
      <div className="min-h-screen flex flex-col">
        <GlobalHeader />
        
        {/* Court Title */}
        <div className="px-4 py-3 flex items-center gap-3 border-b border-border">
          <Button asChild variant="ghost" size="icon" className="shrink-0">
            <Link to="/public">
              <ChevronLeft className="h-5 w-5" />
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">{courtName}</h1>
        </div>

        {/* Court Pulse */}
        <CourtPulse
          courtState={courtState}
          matches={matches}
          players={players}
          totalMatches={matches.length || 17}
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
              courtId={courtNumber}
              players={players}
              matches={matches}
              courtState={courtState}
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
            <DynamicFooterText />
          </p>
        </div>
      </div>
    </PageLayout>
  );
};

// Inline dynamic footer for public court page
import { useEventContext, GOOSEPICK_THURSDAYS_ID } from "@/hooks/useEventContext";
import { format } from "date-fns";

const DynamicFooterText = () => {
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

export default PublicCourt;

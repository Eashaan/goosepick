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

const PublicCourt = () => {
  const { courtId } = useParams();
  const courtNumber = parseInt(courtId || "1");
  const queryClient = useQueryClient();

  // Fetch players
  const { data: players = [] } = useQuery({
    queryKey: ["players", courtNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("court_id", courtNumber)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Fetch matches
  const { data: matches = [] } = useQuery({
    queryKey: ["matches", courtNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("court_id", courtNumber)
        .order("match_index", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Fetch court state
  const { data: courtState } = useQuery({
    queryKey: ["court_state", courtNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("court_state")
        .select("*")
        .eq("court_id", courtNumber)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch court details for display name
  const { data: courtDetails } = useQuery({
    queryKey: ["court_details", courtNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courts")
        .select("*")
        .eq("id", courtNumber)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const courtName = courtDetails?.name || `Court ${courtNumber}`;

  // Set up realtime subscriptions
  useEffect(() => {
    const channel = supabase
      .channel(`court-${courtNumber}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "court_state",
          filter: `court_id=eq.${courtNumber}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["court_state", courtNumber] });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "matches",
          filter: `court_id=eq.${courtNumber}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["matches", courtNumber] });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `court_id=eq.${courtNumber}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["players", courtNumber] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [courtNumber, queryClient]);

  return (
    <PageLayout showFooter={false}>
      <div className="min-h-screen flex flex-col">
        {/* Global Header with Logo */}
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

        {/* Tabs - Only Personal Roster and Leaderboard */}
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
            Goosepick Social – February 1, 2026
          </p>
        </div>
      </div>
    </PageLayout>
  );
};

export default PublicCourt;

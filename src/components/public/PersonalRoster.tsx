import { useState, useEffect, useMemo } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, Download } from "lucide-react";
import SlotMachineRoadmap from "./SlotMachineRoadmap";
import PersonalStats from "./PersonalStats";
import StatsCardModal from "./StatsCardModal";
import FeedbackModal from "./FeedbackModal";

type CourtState = Database["public"]["Tables"]["court_state"]["Row"];
type Match = Database["public"]["Tables"]["matches"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

interface PersonalRosterProps {
  courtId: number;
  players: Player[];
  matches: Match[];
  courtState: CourtState | undefined;
}

const PersonalRoster = ({ courtId, players, matches, courtState }: PersonalRosterProps) => {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(true);
  const [showStatsCard, setShowStatsCard] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  // Load saved player from localStorage
  useEffect(() => {
    const savedId = localStorage.getItem(`gp_person_${courtId}`);
    if (savedId && players.find(p => p.id === savedId)) {
      setSelectedPlayerId(savedId);
    }
  }, [courtId, players]);

  // Save selected player to localStorage
  const handlePlayerSelect = (playerId: string) => {
    setSelectedPlayerId(playerId);
    localStorage.setItem(`gp_person_${courtId}`, playerId);
  };

  // Get player's matches
  const playerMatches = useMemo(() => {
    if (!selectedPlayerId) return [];
    return matches.filter(
      m =>
        m.team1_player1_id === selectedPlayerId ||
        m.team1_player2_id === selectedPlayerId ||
        m.team2_player1_id === selectedPlayerId ||
        m.team2_player2_id === selectedPlayerId
    ).sort((a, b) => a.match_index - b.match_index);
  }, [selectedPlayerId, matches]);

  // Calculate "You're Up Next" nudge
  const getNudgeMessage = () => {
    if (!selectedPlayerId || !courtState || playerMatches.length === 0) return null;
    
    const currentMatchIndex = courtState.current_match_index;
    const phase = courtState.phase;

    // Check if player is in current match
    const currentMatch = matches.find(m => m.match_index === currentMatchIndex);
    const isInCurrentMatch = currentMatch && (
      currentMatch.team1_player1_id === selectedPlayerId ||
      currentMatch.team1_player2_id === selectedPlayerId ||
      currentMatch.team2_player1_id === selectedPlayerId ||
      currentMatch.team2_player2_id === selectedPlayerId
    );

    if (phase === "in_progress" && isInCurrentMatch) {
      return { text: `You're live on Court ${courtId}.`, type: "playing" };
    }

    // Find next match for player
    const nextPlayerMatch = playerMatches.find(m => m.match_index > currentMatchIndex);
    const completedPlayerMatches = playerMatches.filter(m => 
      m.match_index < currentMatchIndex || (m.match_index === currentMatchIndex && phase === "completed")
    );

    // Check if player is done
    if (!nextPlayerMatch && completedPlayerMatches.length === playerMatches.length) {
      return { text: "You're done for today. Nice work 👏", type: "finished" };
    }

    if (!nextPlayerMatch) return null;

    const matchesAway = nextPlayerMatch.match_index - currentMatchIndex;

    if (matchesAway === 1) {
      return { text: "You're up next. Grab water & be courtside.", type: "next" };
    } else if (matchesAway === 2) {
      return { text: "You've got time. Stretch or watch the match.", type: "soon" };
    }

    return null;
  };

  // Check if player has completed all their matches
  const hasCompletedAllMatches = useMemo(() => {
    if (!selectedPlayerId || !courtState || playerMatches.length === 0) return false;
    
    const currentMatchIndex = courtState.current_match_index;
    const lastPlayerMatch = playerMatches[playerMatches.length - 1];
    
    // Player is done if their last match index is less than current, 
    // or equal to current and phase is not in_progress
    return lastPlayerMatch.match_index < currentMatchIndex ||
      (lastPlayerMatch.match_index === currentMatchIndex && courtState.phase !== "in_progress" && courtState.phase !== "idle");
  }, [selectedPlayerId, courtState, playerMatches]);

  // Trigger feedback modal when player completes final match
  useEffect(() => {
    const checkFeedback = async () => {
      if (!hasCompletedAllMatches || !selectedPlayerId || feedbackSubmitted) return;
      
      // Check if feedback already submitted
      const submitted = localStorage.getItem(`gp_feedback_${courtId}_${selectedPlayerId}`);
      if (submitted) {
        setFeedbackSubmitted(true);
        return;
      }
      
      // Show feedback modal
      setShowFeedback(true);
    };
    
    checkFeedback();
  }, [hasCompletedAllMatches, selectedPlayerId, courtId, feedbackSubmitted]);

  const nudge = getNudgeMessage();
  const selectedPlayer = players.find(p => p.id === selectedPlayerId);

  if (!selectedPlayerId) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-4">Who are you?</h2>
          <Select onValueChange={handlePlayerSelect}>
            <SelectTrigger className="w-full max-w-xs mx-auto h-14 text-lg bg-secondary rounded-xl">
              <SelectValue placeholder="Select your name" />
            </SelectTrigger>
            <SelectContent>
              {players.map((player) => (
                <SelectItem key={player.id} value={player.id}>
                  {player.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Player identifier */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm text-muted-foreground">Playing as</span>
          <p className="text-lg font-semibold">{selectedPlayer?.name}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSelectedPlayerId(null);
            localStorage.removeItem(`gp_person_${courtId}`);
          }}
          className="text-muted-foreground"
        >
          Change
        </Button>
      </div>

      {/* Nudge message */}
      {nudge && (
        <div className={`p-4 rounded-xl text-center ${
          nudge.type === "playing" ? "bg-primary/10 border border-primary/30" :
          nudge.type === "finished" ? "bg-primary/5" :
          "bg-secondary"
        }`}>
          <p className={`font-medium ${nudge.type === "playing" ? "text-primary" : "text-foreground"}`}>
            {nudge.text}
          </p>
        </div>
      )}

      {/* Slot Machine Roadmap */}
      {playerMatches.length > 0 && (
        <SlotMachineRoadmap
          playerMatches={playerMatches}
          allMatches={matches}
          players={players}
          courtState={courtState}
          selectedPlayerId={selectedPlayerId}
        />
      )}

      {/* Personal Stats */}
      <Collapsible open={statsOpen} onOpenChange={setStatsOpen}>
        <Card className="bg-card border-border">
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                Your Goosepick Social – February 1, 2026
              </CardTitle>
              <ChevronDown className={`h-5 w-5 transition-transform ${statsOpen ? "rotate-180" : ""}`} />
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              <PersonalStats
                playerId={selectedPlayerId}
                matches={matches}
                players={players}
              />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Stats Card Download */}
      {hasCompletedAllMatches && (
        <div className="text-center space-y-4">
          <p className="text-muted-foreground">You're done for today 👏</p>
          <Button
            onClick={() => setShowStatsCard(true)}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            Preview & Download Your Personal Stats Card
          </Button>
        </div>
      )}

      {/* Stats Card Modal */}
      <StatsCardModal
        open={showStatsCard}
        onOpenChange={setShowStatsCard}
        playerId={selectedPlayerId}
        playerName={selectedPlayer?.name || ""}
        matches={matches}
        players={players}
      />

      {/* Feedback Modal */}
      <FeedbackModal
        open={showFeedback}
        onOpenChange={setShowFeedback}
        courtId={courtId}
        playerId={selectedPlayerId}
        onSubmitted={() => {
          setFeedbackSubmitted(true);
          localStorage.setItem(`gp_feedback_${courtId}_${selectedPlayerId}`, "true");
        }}
      />
    </div>
  );
};

export default PersonalRoster;

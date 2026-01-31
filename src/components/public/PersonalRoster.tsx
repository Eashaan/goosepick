import { useState, useEffect, useMemo } from "react";
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
import RankPopup from "./RankPopup";
import PodiumSummaryPopup from "./PodiumSummaryPopup";

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
  const [showRankPopup, setShowRankPopup] = useState(false);
  const [showPodiumSummary, setShowPodiumSummary] = useState(false);

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

    // Find next match for player - use status field
    const nextPlayerMatch = playerMatches.find(m => m.status !== "completed");
    const completedPlayerMatches = playerMatches.filter(m => m.status === "completed");

    // Check if player is done
    if (!nextPlayerMatch && completedPlayerMatches.length === playerMatches.length && playerMatches.length > 0) {
      return { text: "You're done for today. Nice work 👏", type: "finished" };
    }

    if (!nextPlayerMatch) return null;

    // Count how many uncompleted matches are before the player's next match
    const uncompletedMatchesBefore = matches.filter(m => 
      m.status !== "completed" && m.match_index < nextPlayerMatch.match_index
    ).length;

    if (uncompletedMatchesBefore === 0) {
      return { text: "You're up next. Grab water & be courtside.", type: "next" };
    } else if (uncompletedMatchesBefore === 1) {
      return { text: "You've got time. Stretch or watch the match.", type: "soon" };
    }

    return null;
  };

  // Check if player has completed all their matches - use status field
  const hasCompletedAllMatches = useMemo(() => {
    if (!selectedPlayerId || playerMatches.length === 0) return false;
    
    // Player is done if all their matches have status "completed"
    return playerMatches.every(m => m.status === "completed");
  }, [selectedPlayerId, playerMatches]);

  // Calculate leaderboard and player rank (competition ranking)
  const { playerRank, podiumPlayers, allPlayersHaveMatches } = useMemo(() => {
    // Calculate PI for all players
    const playerStats = players.map(player => {
      const pMatches = matches.filter(m =>
        m.team1_player1_id === player.id ||
        m.team1_player2_id === player.id ||
        m.team2_player1_id === player.id ||
        m.team2_player2_id === player.id
      );

      const completedMatches = pMatches.filter(m => m.status === "completed");
      let wins = 0;
      let totalPointDiff = 0;

      completedMatches.forEach(match => {
        const isTeam1 = match.team1_player1_id === player.id || match.team1_player2_id === player.id;
        const team1Score = match.team1_score || 0;
        const team2Score = match.team2_score || 0;

        if (isTeam1) {
          if (team1Score > team2Score) wins++;
          totalPointDiff += team1Score - team2Score;
        } else {
          if (team2Score > team1Score) wins++;
          totalPointDiff += team2Score - team1Score;
        }
      });

      const matchCount = completedMatches.length;
      const winPercentage = matchCount > 0 ? (wins / matchCount) * 100 : 0;
      const avgPointDiff = matchCount > 0 ? totalPointDiff / matchCount : 0;
      const performanceIndex = winPercentage + avgPointDiff;

      return {
        id: player.id,
        name: player.name,
        matchCount,
        totalMatches: pMatches.length,
        performanceIndex,
        isFinished: matchCount === pMatches.length && pMatches.length > 0,
      };
    });

    // Sort by PI descending
    const sorted = [...playerStats].sort((a, b) => b.performanceIndex - a.performanceIndex);
    
    // Check if all players have at least 1 match
    const allHaveMatches = playerStats.length > 0 && playerStats.every(s => s.matchCount > 0);

    // Competition ranking: same PI = same rank, next distinct PI gets skipped ranks
    let currentRank = 1;
    const rankedPlayers = sorted.map((player, index) => {
      if (index > 0 && player.performanceIndex < sorted[index - 1].performanceIndex) {
        currentRank = index + 1;
      }
      return { ...player, rank: currentRank };
    });

    // Get player's rank
    const selectedPlayerStats = rankedPlayers.find(p => p.id === selectedPlayerId);
    const rank = selectedPlayerStats?.rank || 0;

    // Get podium (top 3 ranks)
    const podium = rankedPlayers.filter(p => p.rank <= 3);

    return { 
      playerRank: rank, 
      podiumPlayers: podium.map(p => ({ name: p.name, rank: p.rank })),
      allPlayersHaveMatches: allHaveMatches
    };
  }, [players, matches, selectedPlayerId]);

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

  // Trigger rank popup for selected player when they complete all matches
  useEffect(() => {
    if (!hasCompletedAllMatches || !selectedPlayerId || playerRank === 0) return;

    // Check if rank popup already shown for this player
    const shownKey = `gp_rank_popup_${courtId}_${selectedPlayerId}`;
    const alreadyShown = localStorage.getItem(shownKey);
    if (alreadyShown) return;

    // Small delay to let feedback modal show first
    const timer = setTimeout(() => {
      if (!showFeedback) {
        setShowRankPopup(true);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [hasCompletedAllMatches, selectedPlayerId, playerRank, courtId, showFeedback]);

  // Show rank popup after feedback is dismissed
  useEffect(() => {
    if (feedbackSubmitted && hasCompletedAllMatches && selectedPlayerId && playerRank > 0) {
      const shownKey = `gp_rank_popup_${courtId}_${selectedPlayerId}`;
      const alreadyShown = localStorage.getItem(shownKey);
      if (!alreadyShown && !showFeedback) {
        setShowRankPopup(true);
      }
    }
  }, [feedbackSubmitted, hasCompletedAllMatches, selectedPlayerId, playerRank, courtId, showFeedback]);

  // Fallback: Show podium summary when no player selected but all have at least 1 match
  useEffect(() => {
    if (selectedPlayerId) return; // Only for anonymous viewers
    if (!allPlayersHaveMatches || players.length === 0) return;

    const shownKey = `gp_podium_shown_${courtId}`;
    const alreadyShown = localStorage.getItem(shownKey);
    if (alreadyShown) return;

    setShowPodiumSummary(true);
  }, [selectedPlayerId, allPlayersHaveMatches, courtId, players.length]);

  const handleRankPopupClose = () => {
    setShowRankPopup(false);
    if (selectedPlayerId) {
      localStorage.setItem(`gp_rank_popup_${courtId}_${selectedPlayerId}`, "true");
    }
  };

  const handlePodiumSummaryClose = () => {
    setShowPodiumSummary(false);
    localStorage.setItem(`gp_podium_shown_${courtId}`, "true");
  };

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

        {/* Podium Summary for anonymous viewers */}
        {showPodiumSummary && podiumPlayers.length > 0 && (
          <PodiumSummaryPopup
            podium={podiumPlayers}
            onClose={handlePodiumSummaryClose}
          />
        )}
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

      {/* Rank Popup for selected player */}
      {showRankPopup && playerRank > 0 && (
        <RankPopup
          rank={playerRank}
          playerName={selectedPlayer?.name || ""}
          onClose={handleRankPopupClose}
        />
      )}
    </div>
  );
};

export default PersonalRoster;

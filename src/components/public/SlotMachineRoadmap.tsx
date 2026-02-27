import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Database } from "@/integrations/supabase/types";

type CourtState = Database["public"]["Tables"]["court_state"]["Row"];
type Match = Database["public"]["Tables"]["matches"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

interface SlotMachineRoadmapProps {
  playerMatches: Match[];
  allMatches: Match[];
  players: Player[];
  courtState: CourtState | undefined;
  selectedPlayerId: string;
  isGroupMode?: boolean;
}

const SlotMachineRoadmap = ({
  playerMatches,
  allMatches,
  players,
  courtState,
  selectedPlayerId,
  isGroupMode = false,
}: SlotMachineRoadmapProps) => {
  const currentMatchIndex = courtState?.current_match_index || 0;

  const getPlayerName = (playerId: string | null) => {
    if (!playerId) return "—";
    const player = players.find(p => p.id === playerId);
    return player?.name || "—";
  };

  const getPartner = (match: Match) => {
    if (match.team1_player1_id === selectedPlayerId) return getPlayerName(match.team1_player2_id);
    if (match.team1_player2_id === selectedPlayerId) return getPlayerName(match.team1_player1_id);
    if (match.team2_player1_id === selectedPlayerId) return getPlayerName(match.team2_player2_id);
    if (match.team2_player2_id === selectedPlayerId) return getPlayerName(match.team2_player1_id);
    return "—";
  };

  const getOpponents = (match: Match) => {
    const isTeam1 = match.team1_player1_id === selectedPlayerId || match.team1_player2_id === selectedPlayerId;
    if (isTeam1) {
      return `${getPlayerName(match.team2_player1_id)} & ${getPlayerName(match.team2_player2_id)}`;
    }
    return `${getPlayerName(match.team1_player1_id)} & ${getPlayerName(match.team1_player2_id)}`;
  };

  // Build roadmap items including sit-out dots
  const roadmapItems = useMemo(() => {
    const items: Array<{
      type: "match" | "sitout";
      match?: Match;
      matchesUntilNext?: number;
      isActive: boolean;
      isPast: boolean;
    }> = [];

    let previousMatchIndex = -1;

    playerMatches.forEach((match, idx) => {
      // Add sit-out dots between matches
      const gap = match.match_index - previousMatchIndex - 1;
      for (let i = 0; i < gap; i++) {
        const sitoutIndex = previousMatchIndex + 1 + i;
        items.push({
          type: "sitout",
          matchesUntilNext: gap - i,
          isActive: sitoutIndex === currentMatchIndex,
          isPast: sitoutIndex < currentMatchIndex,
        });
      }

      // Add match bubble - use status field for completion
      const isCompleted = match.status === "completed";
      items.push({
        type: "match",
        match,
        isActive: match.match_index === currentMatchIndex && match.status !== "completed",
        isPast: isCompleted,
      });

      previousMatchIndex = match.match_index;
    });

    return items;
  }, [playerMatches, currentMatchIndex]);

  // Find the active item index for centering
  const activeItemIndex = roadmapItems.findIndex(item => item.isActive);
  const displayIndex = activeItemIndex >= 0 ? activeItemIndex : 
    roadmapItems.findIndex(item => !item.isPast) || 0;

  // Calculate visible window (center on active/next item)
  const getVisibleItems = () => {
    const start = Math.max(0, displayIndex - 1);
    const end = Math.min(roadmapItems.length, displayIndex + 2);
    return roadmapItems.slice(start, end);
  };

  const visibleItems = getVisibleItems();

  return (
    <div className="relative h-64 overflow-hidden rounded-2xl bg-secondary/50 border border-border">
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <AnimatePresence mode="popLayout">
          {visibleItems.map((item, idx) => {
            const isCenter = item.isActive || (activeItemIndex < 0 && !item.isPast && idx === 0);
            
            return (
              <motion.div
                key={`${item.type}-${item.match?.id || idx}-${item.matchesUntilNext || 0}`}
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -50, opacity: 0 }}
                transition={{ duration: 0.45, ease: "easeInOut" }}
                className="flex flex-col items-center"
              >
                {item.type === "match" ? (
                  <div
                    className={`px-6 py-4 rounded-2xl transition-all duration-300 ${
                      isCenter
                        ? "bg-primary text-primary-foreground scale-105 shadow-glow"
                        : item.isPast
                        ? "bg-muted text-muted-foreground scale-95 opacity-60"
                        : "bg-card text-card-foreground scale-95 opacity-70"
                    }`}
                  >
                    <div className="text-center">
                      <p className="text-xs uppercase tracking-wide opacity-70 mb-1">
                        Match {item.match!.match_index + 1}
                      </p>
                      <p className="font-semibold">
                        with {getPartner(item.match!)}
                      </p>
                      <p className="text-sm opacity-80 mt-1">
                        vs {getOpponents(item.match!)}
                      </p>
                      {item.match!.team1_score !== null && item.match!.team2_score !== null && (
                        <p className="text-sm font-semibold mt-2">
                          {item.match!.team1_score} - {item.match!.team2_score}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-2">
                    <div className="w-0.5 h-6 bg-border" />
                    <div
                      className={`w-3 h-3 rounded-full transition-all duration-300 ${
                        isCenter
                          ? "bg-primary shadow-glow"
                          : item.isPast
                          ? "bg-muted-foreground/50"
                          : "bg-muted-foreground/30"
                      }`}
                    />
                    {isCenter && item.matchesUntilNext && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Your next tie is after {item.matchesUntilNext} match{item.matchesUntilNext !== 1 ? "es" : ""}
                      </p>
                    )}
                    <div className="w-0.5 h-6 bg-border" />
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Gradient overlays for mystery effect */}
      <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-secondary/50 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-secondary/50 to-transparent pointer-events-none" />
    </div>
  );
};

export default SlotMachineRoadmap;

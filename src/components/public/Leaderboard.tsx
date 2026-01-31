import { useMemo, useEffect, useState } from "react";
import { Database } from "@/integrations/supabase/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PodiumPopup from "./PodiumPopup";

type Match = Database["public"]["Tables"]["matches"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

interface LeaderboardProps {
  matches: Match[];
  players: Player[];
}

interface PlayerStats {
  id: string;
  name: string;
  matches: number;
  totalMatches: number;
  wins: number;
  winPercentage: number;
  avgPointDiff: number;
  performanceIndex: number;
  isFinished: boolean;
}

type PodiumTier = "gold" | "silver" | "bronze" | null;

const Leaderboard = ({ matches, players }: LeaderboardProps) => {
  const [shownPopups, setShownPopups] = useState<Set<string>>(() => {
    const stored = localStorage.getItem("gp_podium_popups_shown");
    return stored ? new Set(JSON.parse(stored)) : new Set();
  });
  const [currentPopup, setCurrentPopup] = useState<{ playerId: string; tier: PodiumTier; name: string } | null>(null);

  const { leaderboard, podiumTiers, allPlayersHaveMatches } = useMemo(() => {
    const stats: PlayerStats[] = players.map(player => {
      const playerMatches = matches.filter(m =>
        m.team1_player1_id === player.id ||
        m.team1_player2_id === player.id ||
        m.team2_player1_id === player.id ||
        m.team2_player2_id === player.id
      );

      const completedMatches = playerMatches.filter(m => 
        m.status === "completed"
      );

      const totalMatchesForPlayer = playerMatches.length;

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
        matches: matchCount,
        totalMatches: totalMatchesForPlayer,
        wins,
        winPercentage,
        avgPointDiff,
        performanceIndex,
        isFinished: matchCount === totalMatchesForPlayer && totalMatchesForPlayer > 0,
      };
    });

    // Sort by Performance Index descending
    const sortedStats = stats.sort((a, b) => b.performanceIndex - a.performanceIndex);
    
    // Check if all players have at least one match
    const allHaveMatches = stats.length > 0 && stats.every(s => s.matches > 0);
    
    // Calculate podium tiers based on distinct PI values
    const tiers: Record<string, PodiumTier> = {};
    
    if (allHaveMatches) {
      const distinctPIs = [...new Set(sortedStats.map(s => s.performanceIndex))].sort((a, b) => b - a);
      
      sortedStats.forEach(player => {
        const piRank = distinctPIs.indexOf(player.performanceIndex);
        if (piRank === 0) tiers[player.id] = "gold";
        else if (piRank === 1) tiers[player.id] = "silver";
        else if (piRank === 2) tiers[player.id] = "bronze";
        else tiers[player.id] = null;
      });
    }

    return { leaderboard: sortedStats, podiumTiers: tiers, allPlayersHaveMatches: allHaveMatches };
  }, [matches, players]);

  // Check for podium popup triggers
  useEffect(() => {
    if (!allPlayersHaveMatches) return;

    for (const player of leaderboard) {
      const tier = podiumTiers[player.id];
      if (tier && player.isFinished) {
        const popupKey = `${player.id}`;
        if (!shownPopups.has(popupKey)) {
          setCurrentPopup({ playerId: player.id, tier, name: player.name });
          break;
        }
      }
    }
  }, [leaderboard, podiumTiers, shownPopups, allPlayersHaveMatches]);

  const handleClosePopup = () => {
    if (currentPopup) {
      const newShown = new Set(shownPopups);
      newShown.add(currentPopup.playerId);
      setShownPopups(newShown);
      localStorage.setItem("gp_podium_popups_shown", JSON.stringify([...newShown]));
    }
    setCurrentPopup(null);
  };

  const getTierStyles = (tier: PodiumTier) => {
    switch (tier) {
      case "gold":
        return "bg-yellow-500/10";
      case "silver":
        return "bg-gray-300/10";
      case "bronze":
        return "bg-amber-600/10";
      default:
        return "";
    }
  };

  const getMedalEmoji = (tier: PodiumTier) => {
    switch (tier) {
      case "gold":
        return "🥇";
      case "silver":
        return "🥈";
      case "bronze":
        return "🥉";
      default:
        return null;
    }
  };

  if (players.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No players registered yet...</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border">
              <TableHead className="sticky left-0 bg-background z-10 text-xs">Player</TableHead>
              <TableHead className="text-xs text-center">Matches</TableHead>
              <TableHead className="text-xs text-center">Wins</TableHead>
              <TableHead className="text-xs text-center">Win %</TableHead>
              <TableHead className="text-xs text-center whitespace-nowrap">Avg Diff</TableHead>
              <TableHead className="text-xs text-center">PI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaderboard.map((player, index) => {
              const tier = allPlayersHaveMatches ? podiumTiers[player.id] : null;
              const medal = getMedalEmoji(tier);
              
              return (
                <TableRow 
                  key={player.id} 
                  className={`border-border ${getTierStyles(tier)}`}
                >
                  <TableCell className={`sticky left-0 z-10 font-medium ${getTierStyles(tier)} bg-background`}>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-xs w-4">{index + 1}</span>
                      {medal && <span className="text-sm">{medal}</span>}
                      <span className="truncate max-w-[120px]">{player.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">{player.matches}</TableCell>
                  <TableCell className="text-center">{player.wins}</TableCell>
                  <TableCell className="text-center">{player.winPercentage.toFixed(0)}%</TableCell>
                  <TableCell className="text-center">
                    <span className={player.avgPointDiff > 0 ? "text-green-500" : player.avgPointDiff < 0 ? "text-red-500" : ""}>
                      {player.avgPointDiff > 0 ? "+" : ""}{player.avgPointDiff.toFixed(1)}
                    </span>
                  </TableCell>
                  <TableCell className="text-center font-semibold text-primary">
                    {player.performanceIndex.toFixed(1)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {currentPopup && (
        <PodiumPopup
          tier={currentPopup.tier!}
          playerName={currentPopup.name}
          onClose={handleClosePopup}
        />
      )}
    </>
  );
};

export default Leaderboard;

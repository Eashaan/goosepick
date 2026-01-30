import { useMemo } from "react";
import { Database } from "@/integrations/supabase/types";

type Match = Database["public"]["Tables"]["matches"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

interface PersonalStatsProps {
  playerId: string;
  matches: Match[];
  players: Player[];
}

const PersonalStats = ({ playerId, matches, players }: PersonalStatsProps) => {
  const stats = useMemo(() => {
    const playerMatches = matches.filter(m =>
      m.team1_player1_id === playerId ||
      m.team1_player2_id === playerId ||
      m.team2_player1_id === playerId ||
      m.team2_player2_id === playerId
    );

    const completedMatches = playerMatches.filter(m => 
      m.team1_score !== null && m.team2_score !== null
    );

    let wins = 0;
    let totalPointDiff = 0;
    const partnerCounts: Record<string, number> = {};

    completedMatches.forEach(match => {
      const isTeam1 = match.team1_player1_id === playerId || match.team1_player2_id === playerId;
      const team1Score = match.team1_score || 0;
      const team2Score = match.team2_score || 0;

      // Count wins and point diff
      if (isTeam1) {
        if (team1Score > team2Score) wins++;
        totalPointDiff += team1Score - team2Score;
        
        // Track partner
        const partnerId = match.team1_player1_id === playerId ? match.team1_player2_id : match.team1_player1_id;
        if (partnerId) partnerCounts[partnerId] = (partnerCounts[partnerId] || 0) + 1;
      } else {
        if (team2Score > team1Score) wins++;
        totalPointDiff += team2Score - team1Score;
        
        // Track partner
        const partnerId = match.team2_player1_id === playerId ? match.team2_player2_id : match.team2_player1_id;
        if (partnerId) partnerCounts[partnerId] = (partnerCounts[partnerId] || 0) + 1;
      }
    });

    const matchCount = completedMatches.length;
    const winPercentage = matchCount > 0 ? (wins / matchCount) * 100 : 0;
    const avgPointDiff = matchCount > 0 ? totalPointDiff / matchCount : 0;
    const performanceIndex = winPercentage + avgPointDiff;

    // Find most common partner
    let mostCommonPartner = "—";
    let maxPartnerCount = 0;
    Object.entries(partnerCounts).forEach(([partnerId, count]) => {
      if (count > maxPartnerCount) {
        maxPartnerCount = count;
        const partner = players.find(p => p.id === partnerId);
        mostCommonPartner = partner?.name || "—";
      }
    });

    return {
      matchesPlayed: matchCount,
      wins,
      winPercentage,
      avgPointDiff,
      performanceIndex,
      mostCommonPartner,
    };
  }, [playerId, matches, players]);

  const statItems = [
    { label: "Matches Played", value: stats.matchesPlayed.toString() },
    { label: "Wins", value: stats.wins.toString() },
    { label: "Win %", value: `${stats.winPercentage.toFixed(0)}%` },
    { label: "Avg Point Diff / Match", value: stats.avgPointDiff > 0 ? `+${stats.avgPointDiff.toFixed(1)}` : stats.avgPointDiff.toFixed(1) },
    { label: "Performance Index", value: stats.performanceIndex.toFixed(1), highlight: true },
    { label: "Most Common Partner", value: stats.mostCommonPartner },
  ];

  return (
    <div className="grid grid-cols-2 gap-4">
      {statItems.map((item) => (
        <div key={item.label} className="text-center">
          <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
          <p className={`text-lg font-semibold ${item.highlight ? "text-primary" : ""}`}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
};

export default PersonalStats;

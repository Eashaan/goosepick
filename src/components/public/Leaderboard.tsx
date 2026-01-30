import { useMemo } from "react";
import { Database } from "@/integrations/supabase/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  wins: number;
  winPercentage: number;
  avgPointDiff: number;
  performanceIndex: number;
}

const Leaderboard = ({ matches, players }: LeaderboardProps) => {
  const leaderboard = useMemo(() => {
    const stats: PlayerStats[] = players.map(player => {
      const playerMatches = matches.filter(m =>
        m.team1_player1_id === player.id ||
        m.team1_player2_id === player.id ||
        m.team2_player1_id === player.id ||
        m.team2_player2_id === player.id
      );

      const completedMatches = playerMatches.filter(m => 
        m.team1_score !== null && m.team2_score !== null
      );

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
        wins,
        winPercentage,
        avgPointDiff,
        performanceIndex,
      };
    });

    // Sort by Performance Index descending
    return stats.sort((a, b) => b.performanceIndex - a.performanceIndex);
  }, [matches, players]);

  if (players.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">No players registered yet...</p>
      </div>
    );
  }

  return (
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
          {leaderboard.map((player, index) => (
            <TableRow key={player.id} className="border-border">
              <TableCell className="sticky left-0 bg-background z-10 font-medium">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs w-4">{index + 1}</span>
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
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export default Leaderboard;

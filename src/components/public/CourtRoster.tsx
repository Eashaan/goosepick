import { Database } from "@/integrations/supabase/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Match = Database["public"]["Tables"]["matches"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

interface CourtRosterProps {
  matches: Match[];
  players: Player[];
  currentMatchIndex: number | undefined;
}

const CourtRoster = ({ matches, players, currentMatchIndex = 0 }: CourtRosterProps) => {
  const getPlayerName = (playerId: string | null) => {
    if (!playerId) return "—";
    const player = players.find(p => p.id === playerId);
    return player?.name || "—";
  };

  if (matches.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Waiting for rotation to be generated...</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border">
            <TableHead className="text-xs">#</TableHead>
            <TableHead className="text-xs">Team 1</TableHead>
            <TableHead className="text-xs">Team 2</TableHead>
            <TableHead className="text-xs text-center">Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {matches.map((match) => {
            const isCurrent = match.match_index === currentMatchIndex;
            const isCompleted = match.team1_score !== null && match.team2_score !== null;
            const isPast = match.match_index < currentMatchIndex;

            return (
              <TableRow
                key={match.id}
                className={`border-border ${
                  isCurrent ? "bg-primary/10" : isPast ? "opacity-60" : ""
                }`}
              >
                <TableCell className={`font-medium ${isCurrent ? "text-primary" : ""}`}>
                  {match.match_index + 1}
                </TableCell>
                <TableCell className="text-sm">
                  <div>
                    <p>{getPlayerName(match.team1_player1_id)}</p>
                    <p>{getPlayerName(match.team1_player2_id)}</p>
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  <div>
                    <p>{getPlayerName(match.team2_player1_id)}</p>
                    <p>{getPlayerName(match.team2_player2_id)}</p>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  {isCompleted ? (
                    <span className="font-semibold">
                      {match.team1_score} - {match.team2_score}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
};

export default CourtRoster;

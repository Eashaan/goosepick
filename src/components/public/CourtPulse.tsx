import { Database } from "@/integrations/supabase/types";

type CourtState = Database["public"]["Tables"]["court_state"]["Row"];
type Match = Database["public"]["Tables"]["matches"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

interface CourtPulseProps {
  courtState: CourtState | undefined;
  matches: Match[];
  players: Player[];
  totalMatches: number;
}

const CourtPulse = ({ courtState, matches, players, totalMatches }: CourtPulseProps) => {
  const getPlayerName = (playerId: string | null) => {
    if (!playerId) return "—";
    const player = players.find(p => p.id === playerId);
    return player?.name || "—";
  };

  const currentMatchIndex = courtState?.current_match_index || 0;
  const currentMatch = matches.find(m => m.match_index === currentMatchIndex);
  const phase = courtState?.phase || "idle";

  const getStatusLabel = () => {
    if (phase === "completed") return "Court Completed";
    if (phase === "in_progress") return "Now Playing";
    return "Up Next";
  };

  const getNextMatch = () => {
    if (phase === "completed") return null;
    return currentMatch;
  };

  const nextMatch = getNextMatch();

  return (
    <div className="px-4 py-6 bg-card border-b border-border">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-sm font-semibold uppercase tracking-wide ${
          phase === "in_progress" ? "text-primary" : "text-muted-foreground"
        }`}>
          {getStatusLabel()}
        </span>
        <span className="text-sm text-muted-foreground">
          Match {currentMatchIndex + 1} of {totalMatches || 17}
        </span>
      </div>

      {nextMatch && phase !== "completed" ? (
        <div className={`p-4 rounded-xl ${phase === "in_progress" ? "bg-primary/10 border border-primary/30" : "bg-secondary"}`}>
          <div className="flex items-center justify-center gap-4 text-center">
            <div className="flex-1">
              <p className={`font-semibold ${phase === "in_progress" ? "text-primary" : "text-foreground"}`}>
                {getPlayerName(nextMatch.team1_player1_id)}
              </p>
              <p className={`font-semibold ${phase === "in_progress" ? "text-primary" : "text-foreground"}`}>
                {getPlayerName(nextMatch.team1_player2_id)}
              </p>
            </div>
            <div className="text-muted-foreground font-medium">vs</div>
            <div className="flex-1">
              <p className={`font-semibold ${phase === "in_progress" ? "text-primary" : "text-foreground"}`}>
                {getPlayerName(nextMatch.team2_player1_id)}
              </p>
              <p className={`font-semibold ${phase === "in_progress" ? "text-primary" : "text-foreground"}`}>
                {getPlayerName(nextMatch.team2_player2_id)}
              </p>
            </div>
          </div>
        </div>
      ) : phase === "completed" ? (
        <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 text-center">
          <p className="text-lg font-semibold text-primary">All matches completed!</p>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-secondary text-center">
          <p className="text-muted-foreground">Waiting for rotation...</p>
        </div>
      )}
    </div>
  );
};

export default CourtPulse;

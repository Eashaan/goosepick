import { Database } from "@/integrations/supabase/types";

type Match = Database["public"]["Tables"]["matches"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];
type GroupCourtState = Database["public"]["Tables"]["group_court_state"]["Row"];

interface GroupCourtPulseProps {
  courtStates: GroupCourtState[];
  matches: Match[];
  players: Player[];
  totalMatches: number;
  courtIds: number[];
}

const GroupCourtPulse = ({ courtStates, matches, players, totalMatches, courtIds }: GroupCourtPulseProps) => {
  const getPlayerName = (playerId: string | null) => {
    if (!playerId) return "—";
    return players.find(p => p.id === playerId)?.name || "—";
  };

  const completedCount = matches.filter(m => m.status === "completed").length;
  const allCompleted = completedCount === totalMatches && totalMatches > 0;

  // Find live matches across courts
  const liveStates = courtStates.filter(cs => cs.is_live && cs.current_match_id);

  if (allCompleted) {
    return (
      <div className="px-4 py-6 bg-card border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            All Courts Completed
          </span>
          <span className="text-sm text-muted-foreground">
            {completedCount} of {totalMatches} matches
          </span>
        </div>
        <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 text-center">
          <p className="text-lg font-semibold text-primary">All matches completed!</p>
        </div>
      </div>
    );
  }

  if (liveStates.length === 0) {
    return (
      <div className="px-4 py-6 bg-card border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Up Next
          </span>
          <span className="text-sm text-muted-foreground">
            {completedCount} of {totalMatches} matches done
          </span>
        </div>
        <div className="p-4 rounded-xl bg-secondary text-center">
          <p className="text-muted-foreground">Waiting for next match...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 bg-card border-b border-border space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold uppercase tracking-wide text-primary">
          Now Playing
        </span>
        <span className="text-sm text-muted-foreground">
          {completedCount} of {totalMatches} matches done
        </span>
      </div>

      <div className="space-y-2">
        {liveStates.map(cs => {
          const match = matches.find(m => m.id === cs.current_match_id);
          if (!match) return null;

          return (
            <div
              key={cs.id}
              className="p-3 rounded-xl bg-primary/10 border border-primary/30"
            >
              <p className="text-xs text-muted-foreground mb-2 font-medium">
                Court {cs.court_number}
              </p>
              <div className="flex items-center justify-center gap-4 text-center">
                <div className="flex-1">
                  <p className="font-semibold text-primary text-sm">
                    {getPlayerName(match.team1_player1_id)}
                  </p>
                  <p className="font-semibold text-primary text-sm">
                    {getPlayerName(match.team1_player2_id)}
                  </p>
                </div>
                <div className="text-muted-foreground font-medium text-sm">vs</div>
                <div className="flex-1">
                  <p className="font-semibold text-primary text-sm">
                    {getPlayerName(match.team2_player1_id)}
                  </p>
                  <p className="font-semibold text-primary text-sm">
                    {getPlayerName(match.team2_player2_id)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default GroupCourtPulse;

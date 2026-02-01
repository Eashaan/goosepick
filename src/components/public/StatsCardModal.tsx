import { useRef, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";
import { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import goosepickSocialLogo from "@/assets/goosepick-social-logo.png";

type Match = Database["public"]["Tables"]["matches"]["Row"];
type Player = Database["public"]["Tables"]["players"]["Row"];

interface StatsCardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerId: string;
  playerName: string;
  matches: Match[];
  players: Player[];
  onDownloadComplete?: () => void;
}

const StatsCardModal = ({
  open,
  onOpenChange,
  playerId,
  playerName,
  matches,
  players,
  onDownloadComplete,
}: StatsCardModalProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [showShareNudge, setShowShareNudge] = useState(false);

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

    completedMatches.forEach(match => {
      const isTeam1 = match.team1_player1_id === playerId || match.team1_player2_id === playerId;
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
      matchesPlayed: matchCount,
      wins,
      winPercentage,
      avgPointDiff,
      performanceIndex,
    };
  }, [playerId, matches, players]);

  // Format player name with apostrophe handling
  const getPlayerNameTitle = () => {
    const name = playerName.trim();
    if (name.endsWith("s")) {
      return `${name}' Game Day Stats`;
    }
    return `${name}'s Game Day Stats`;
  };

  const handleDownload = async () => {
    if (!cardRef.current) return;

    try {
      // Dynamic import of html2canvas
      const html2canvas = (await import("html2canvas")).default;
      
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#000000",
        scale: 2,
      });

      const link = document.createElement("a");
      link.download = `goosepick-stats-${playerName.toLowerCase().replace(/\s+/g, "-")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();

      // Trigger share nudge
      setShowShareNudge(true);
      
      // Notify parent if callback provided
      if (onDownloadComplete) {
        onDownloadComplete();
      }
    } catch (error) {
      toast.error("Failed to generate image");
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md bg-background border-border p-0 overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Your Stats Card</DialogTitle>
          </DialogHeader>
          
          {/* Stats Card Preview */}
          <div
            ref={cardRef}
            className="p-8 bg-black text-white"
            style={{ fontFamily: "Inter, sans-serif" }}
          >
            {/* Header with logo */}
            <div className="text-center mb-8">
              <div className="w-20 h-20 mx-auto mb-3 flex items-center justify-center">
                <img
                  src={goosepickSocialLogo}
                  alt="Goosepick Social"
                  className="w-full h-full object-contain"
                />
              </div>
              <h2 className="text-lg font-semibold text-[#FF4200] mb-1">
                India's Most Happening Pickleball Experience
              </h2>
              <p className="text-sm text-gray-400">February 1, 2026</p>
            </div>

            {/* Player Name Title */}
            <div className="text-center mb-8">
              <p className="text-2xl font-bold">{getPlayerNameTitle()}</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-6 mb-8">
              <div className="text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Matches</p>
                <p className="text-2xl font-bold">{stats.matchesPlayed}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Wins</p>
                <p className="text-2xl font-bold">{stats.wins}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Win Rate</p>
                <p className="text-2xl font-bold">{stats.winPercentage.toFixed(0)}%</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Avg. Point Diff.</p>
                <p className="text-2xl font-bold">
                  {stats.avgPointDiff > 0 ? "+" : ""}{stats.avgPointDiff.toFixed(1)}
                </p>
              </div>
            </div>

            {/* Performance Index */}
            <div className="text-center p-4 rounded-xl bg-[#FF4200]/10 border border-[#FF4200]/30">
              <p className="text-xs text-[#FF4200] uppercase tracking-wide mb-1">Performance Index</p>
              <p className="text-4xl font-bold text-[#FF4200]">{stats.performanceIndex.toFixed(1)}</p>
            </div>

            {/* Footer */}
            <div className="text-center mt-8 pt-4 border-t border-gray-800">
              <p className="text-base font-medium text-white">@goosepickleball</p>
            </div>
          </div>

          {/* Actions */}
          <div className="p-4 flex gap-3">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              Close
            </Button>
            <Button onClick={handleDownload} className="flex-1 gap-2">
              <Download className="h-4 w-4" />
              Download
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Share Nudge Modal */}
      <Dialog open={showShareNudge} onOpenChange={setShowShareNudge}>
        <DialogContent className="max-w-sm bg-card border-border">
          <DialogHeader>
            <DialogTitle className="text-center">Your Game, Captured.</DialogTitle>
          </DialogHeader>
          <div className="text-center py-4">
            <p className="text-muted-foreground">
              Share your day on Instagram and tag us{" "}
              <span className="text-primary font-semibold">@goosepickleball</span>
            </p>
          </div>
          <Button onClick={() => setShowShareNudge(false)} className="w-full">
            Got it
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default StatsCardModal;

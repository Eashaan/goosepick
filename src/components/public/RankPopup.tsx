import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import confetti from "canvas-confetti";

interface RankPopupProps {
  rank: number;
  playerName: string;
  onClose: () => void;
}

const RankPopup = ({ rank, playerName, onClose }: RankPopupProps) => {
  const hasTriggeredConfetti = useRef(false);

  // Trigger confetti for top 5 only
  useEffect(() => {
    if (rank >= 1 && rank <= 5 && !hasTriggeredConfetti.current) {
      hasTriggeredConfetti.current = true;
      
      // Subtle, premium confetti burst
      const colors = ["#FF4200", "#FFFFFF", "#E8E8E8"];
      
      confetti({
        particleCount: 40,
        spread: 60,
        origin: { y: 0.6 },
        colors: colors,
        scalar: 0.8,
        gravity: 1.2,
        drift: 0,
        ticks: 80,
        disableForReducedMotion: true,
      });
    }
  }, [rank]);

  const getContent = () => {
    switch (rank) {
      case 1:
        return {
          emoji: "🥇",
          placement: "You finished #1 on the leaderboard.",
          microNudge: "Outstanding play.",
        };
      case 2:
        return {
          emoji: "🥈",
          placement: "You finished #2 on the leaderboard.",
          microNudge: "Brilliant effort.",
        };
      case 3:
        return {
          emoji: "🥉",
          placement: "You finished #3 on the leaderboard.",
          microNudge: "Well earned.",
        };
      default:
        return {
          emoji: null,
          placement: `You finished #${rank} on the leaderboard.`,
          microNudge: "Great effort.",
        };
    }
  };

  const { emoji, placement, microNudge } = getContent();
  const isTopThree = rank >= 1 && rank <= 3;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="relative w-full max-w-sm rounded-2xl bg-card border border-border p-8 text-center"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Top 3 layout: medal → orange name → placement → micro-nudge */}
          {isTopThree ? (
            <>
              {/* Medal */}
              <div className="text-6xl mb-4">{emoji}</div>
              
              {/* Player name in orange */}
              <p className="text-xl font-semibold text-primary mb-2">{playerName}</p>
              
              {/* Placement */}
              <h2 className="text-lg font-medium text-foreground mb-2">
                {placement}
              </h2>
              
              {/* Micro-nudge */}
              <p className="text-muted-foreground">{microNudge}</p>
            </>
          ) : (
            <>
              {/* Non-podium layout */}
              <h2 className="text-xl font-semibold text-foreground mb-2">
                {microNudge}
              </h2>
              
              <p className="text-muted-foreground mb-4">{placement}</p>
              
              <p className="text-primary font-medium">{playerName}</p>
            </>
          )}

          {/* CTA */}
          <button
            onClick={onClose}
            className="mt-6 w-full rounded-xl bg-primary py-3 text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            Continue
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default RankPopup;

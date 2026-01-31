import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

interface RankPopupProps {
  rank: number;
  playerName: string;
  onClose: () => void;
}

const RankPopup = ({ rank, playerName, onClose }: RankPopupProps) => {
  const getContent = () => {
    switch (rank) {
      case 1:
        return {
          emoji: "🥇",
          title: "You finished #1 on the leaderboard.",
          message: "Outstanding play.",
        };
      case 2:
        return {
          emoji: "🥈",
          title: "You finished #2 on the leaderboard.",
          message: "Strong performance today.",
        };
      case 3:
        return {
          emoji: "🥉",
          title: "You finished #3 on the leaderboard.",
          message: "Great effort out there.",
        };
      default:
        return {
          emoji: null,
          title: "Great effort.",
          message: `You finished #${rank} on the leaderboard.`,
        };
    }
  };

  const { emoji, title, message } = getContent();

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

          {/* Medal (if top 3) */}
          {emoji && <div className="text-6xl mb-4">{emoji}</div>}

          {/* Title */}
          <h2 className="text-xl font-semibold text-foreground mb-2">
            {title}
          </h2>

          {/* Message */}
          <p className="text-muted-foreground mb-6">{message}</p>

          {/* Player name */}
          <p className="text-primary font-medium">{playerName}</p>

          {/* CTA */}
          <button
            onClick={onClose}
            className="mt-6 w-full rounded-xl bg-primary py-3 text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
          >
            Got it
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default RankPopup;

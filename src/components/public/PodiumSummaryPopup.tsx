import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

interface PodiumPlayer {
  name: string;
  rank: number;
}

interface PodiumSummaryPopupProps {
  podium: PodiumPlayer[]; // Players on the podium (rank 1, 2, 3)
  onClose: () => void;
}

const PodiumSummaryPopup = ({ podium, onClose }: PodiumSummaryPopupProps) => {
  const getMedalEmoji = (rank: number) => {
    switch (rank) {
      case 1: return "🥇";
      case 2: return "🥈";
      case 3: return "🥉";
      default: return null;
    }
  };

  // Group players by rank for handling ties
  const groupedByRank = podium.reduce((acc, player) => {
    if (!acc[player.rank]) {
      acc[player.rank] = [];
    }
    acc[player.rank].push(player.name);
    return acc;
  }, {} as Record<number, string[]>);

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

          {/* Title */}
          <h2 className="text-xl font-semibold text-foreground mb-6">
            Current Podium
          </h2>

          {/* Podium list */}
          <div className="space-y-3">
            {[1, 2, 3].map((rank) => {
              const names = groupedByRank[rank];
              if (!names || names.length === 0) return null;
              
              return (
                <div key={rank} className="flex items-center justify-center gap-2">
                  <span className="text-2xl">{getMedalEmoji(rank)}</span>
                  <span className="text-foreground font-medium">
                    #{rank}: {names.join(", ")}
                  </span>
                </div>
              );
            })}
          </div>

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

export default PodiumSummaryPopup;

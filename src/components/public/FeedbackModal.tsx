import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X } from "lucide-react";

interface FeedbackModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courtId: number;
  playerId: string;
  onSubmitted: () => void;
}

const FeedbackModal = ({
  open,
  onOpenChange,
  courtId,
  playerId,
  onSubmitted,
}: FeedbackModalProps) => {
  const [rating, setRating] = useState<"loved" | "good" | "okay" | null>(null);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!rating) {
      toast.error("Please select a rating");
      return;
    }

    // Client-side validation
    const trimmedNote = note.trim();
    if (trimmedNote.length > 120) {
      toast.error("Note must be 120 characters or less");
      return;
    }

    setIsSubmitting(true);
    try {
      // Use edge function for server-side validation
      const { data, error } = await supabase.functions.invoke('submit-feedback', {
        body: {
          court_id: courtId,
          player_id: playerId,
          rating,
          note: trimmedNote || null,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success("Thank you!");
      onSubmitted();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || "Failed to submit feedback");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkip = () => {
    onSubmitted();
    onOpenChange(false);
  };

  const ratingOptions = [
    { value: "loved" as const, emoji: "😍", label: "Loved it" },
    { value: "good" as const, emoji: "🙂", label: "Good" },
    { value: "okay" as const, emoji: "😐", label: "Okay" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-card border-border">
        {/* Tiny close button */}
        <button
          onClick={() => onOpenChange(false)}
          className="absolute right-2 top-2 p-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          <X className="h-3 w-3" />
        </button>

        <DialogHeader>
          <DialogTitle className="text-center text-xl">You're done with all your matches. Well done 👏</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <p className="text-sm text-muted-foreground text-center">
            Your feedback will help us enhance your next experience with us
          </p>

          {/* Rating options */}
          <div className="flex justify-center gap-4">
            {ratingOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setRating(option.value)}
                className={`flex flex-col items-center p-4 rounded-xl transition-all ${
                  rating === option.value
                    ? "bg-primary/10 border-2 border-primary"
                    : "bg-secondary hover:bg-secondary/80 border-2 border-transparent"
                }`}
              >
                <span className="text-3xl mb-2">{option.emoji}</span>
                <span className="text-xs text-muted-foreground">{option.label}</span>
              </button>
            ))}
          </div>

          {/* Optional note */}
          <div>
            <Textarea
              placeholder="Anything we should improve?"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 120))}
              className="bg-secondary border-border resize-none"
              rows={2}
            />
            <p className="text-xs text-muted-foreground text-right mt-1">
              {note.length}/120
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Button
              onClick={handleSubmit}
              disabled={!rating || isSubmitting}
              className="w-full"
            >
              {isSubmitting ? "Submitting..." : "Submit"}
            </Button>
            <button
              onClick={handleSkip}
              className="text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors py-2"
            >
              Skip
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default FeedbackModal;

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type CourtStatus = "setup" | "locked" | "live" | "completed";

interface CourtStatusCardProps {
  label: string;
  to?: string;
  status: CourtStatus;
  disabled?: boolean;
  disabledLabel?: string;
  onClick?: () => void;
  isLoading?: boolean;
}

const statusStyles: Record<CourtStatus, { border: string; dot: string; glow?: string }> = {
  setup: {
    border: "border-border",
    dot: "",
  },
  locked: {
    border: "border-orange-500/30",
    dot: "bg-muted-foreground/60",
  },
  live: {
    border: "border-orange-500/20",
    dot: "bg-orange-500",
    glow: "shadow-[0_0_6px_rgba(249,115,22,0.5)]",
  },
  completed: {
    border: "border-emerald-500/20",
    dot: "bg-emerald-500/60",
  },
};

const CourtStatusCard = ({ label, to, status, disabled, disabledLabel, onClick, isLoading }: CourtStatusCardProps) => {
  const style = statusStyles[status];

  const dot = status !== "setup" && (
    <span
      className={cn(
        "absolute top-2.5 right-2.5 h-2 w-2 rounded-full",
        style.dot,
        style.glow,
        status === "live" && "animate-pulse"
      )}
    />
  );

  if (disabled) {
    return (
      <Button
        variant="secondary"
        className={cn(
          "h-24 text-base font-semibold rounded-2xl opacity-70 cursor-default flex flex-col items-center justify-center gap-1 relative border",
          style.border
        )}
        disabled
      >
        <span>{label}</span>
        {disabledLabel && (
          <span className="text-xs font-normal text-muted-foreground">{disabledLabel}</span>
        )}
        {dot}
      </Button>
    );
  }

  // onClick variant (for auto-creating court then navigating)
  if (onClick && !to) {
    return (
      <Button
        variant="secondary"
        className={cn(
          "h-24 text-xl font-semibold rounded-2xl hover:bg-primary hover:text-primary-foreground transition-all duration-200 relative border",
          style.border,
          isLoading && "opacity-60 pointer-events-none"
        )}
        onClick={onClick}
      >
        {label}
        {dot}
      </Button>
    );
  }

  return (
    <Button
      asChild
      variant="secondary"
      className={cn(
        "h-24 text-xl font-semibold rounded-2xl hover:bg-primary hover:text-primary-foreground transition-all duration-200 relative border",
        style.border
      )}
    >
      <Link to={to || "#"}>
        {label}
        {dot}
      </Link>
    </Button>
  );
};

export default CourtStatusCard;

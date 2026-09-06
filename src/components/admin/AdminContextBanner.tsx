import { Link } from "react-router-dom";
import { useEventContext } from "@/hooks/useEventContext";

interface AdminContextBannerProps {
  courtName?: string;
}

const AdminContextBanner = ({ courtName }: AdminContextBannerProps) => {
  const { selectedCity, selectedEvent, selectedLocation } = useEventContext();

  const parts: string[] = [];
  if (selectedCity) parts.push(selectedCity.name);
  if (selectedEvent) parts.push(selectedEvent.name);
  if (selectedLocation) parts.push(selectedLocation.name);
  if (courtName) parts.push(courtName);

  if (parts.length === 0) return null;

  return (
    <div className="px-4 py-2 bg-secondary/50 border-b border-border">
      <div className="mx-auto flex max-w-2xl items-center justify-center gap-3 text-xs tracking-wide">
        <p className="min-w-0 truncate text-muted-foreground">{parts.join(" · ")}</p>
        <span className="text-border">|</span>
        <Link
          to="/admin/registrations"
          className="shrink-0 font-semibold text-primary hover:underline"
        >
          Registrations
        </Link>
      </div>
    </div>
  );
};

export default AdminContextBanner;

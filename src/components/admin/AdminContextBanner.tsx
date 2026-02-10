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
      <p className="text-xs text-muted-foreground text-center tracking-wide">
        {parts.join(" · ")}
      </p>
    </div>
  );
};

export default AdminContextBanner;

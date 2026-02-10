import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Lock } from "lucide-react";

type FormatType = "mystery_partner" | "round_robin" | "format_3" | "format_4" | "format_5";

interface FormatSelectorProps {
  currentFormat: FormatType;
  onFormatChange: (format: FormatType) => void;
  disabled?: boolean;
  hasMatches?: boolean;
}

const FORMAT_OPTIONS: { value: FormatType; label: string; enabled: boolean }[] = [
  { value: "mystery_partner", label: "Mystery Partner", enabled: true },
  { value: "round_robin", label: "Round Robin", enabled: false },
  { value: "format_3", label: "Format 3", enabled: false },
  { value: "format_4", label: "Format 4", enabled: false },
  { value: "format_5", label: "Format 5", enabled: false },
];

const FormatSelector = ({ currentFormat, onFormatChange, disabled, hasMatches }: FormatSelectorProps) => {
  const selectedFormat = FORMAT_OPTIONS.find((f) => f.value === currentFormat);
  const isFormatEnabled = selectedFormat?.enabled ?? false;
  const isLocked = hasMatches || disabled;

  return (
    <Card className="bg-card border-border">
      <CardContent className="py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <label className="text-sm font-medium text-muted-foreground">
            Format for this court
          </label>
          <Select
            value={currentFormat}
            onValueChange={(value) => onFormatChange(value as FormatType)}
            disabled={isLocked}
          >
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMAT_OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={!option.enabled}
                  className={!option.enabled ? "text-muted-foreground" : ""}
                >
                  <span className="flex items-center gap-2">
                    {option.label}
                    {!option.enabled && (
                      <span className="text-xs text-muted-foreground">(coming soon)</span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {/* Locked message when matches exist */}
        {hasMatches && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <Lock className="h-4 w-4 mt-0.5 shrink-0" />
            <span>Format cannot be changed once matches are generated.</span>
          </div>
        )}

        {/* Helper text when non-Mystery Partner format is selected */}
        {!hasMatches && !isFormatEnabled && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>This format will be available soon.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default FormatSelector;

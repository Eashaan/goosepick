import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft, Plus, X, Lock } from "lucide-react";

type FormatType = "mystery_partner" | "round_robin" | "format_3" | "format_4" | "format_5";

const FORMAT_OPTIONS: { value: FormatType; label: string; enabled: boolean }[] = [
  { value: "mystery_partner", label: "Mystery Partner", enabled: true },
  { value: "round_robin", label: "Round Robin", enabled: false },
  { value: "format_3", label: "Format 3", enabled: false },
  { value: "format_4", label: "Format 4", enabled: false },
  { value: "format_5", label: "Format 5", enabled: false },
];

interface CourtGroup {
  courtNumbers: number[];
  formatType: FormatType;
}

interface SetupWizardProps {
  cityId: string;
  eventId: string;
  locationId: string | null;
  existingConfigId?: string;
  existingCourtCount?: number;
  existingGroups?: CourtGroup[];
  existingCourtFormats?: Record<number, FormatType>;
  lockedCourtIds?: Set<number>;
  onComplete: () => void;
}

const SetupWizard = ({
  cityId,
  eventId,
  locationId,
  existingConfigId,
  existingCourtCount,
  existingGroups = [],
  existingCourtFormats = {},
  lockedCourtIds = new Set(),
  onComplete,
}: SetupWizardProps) => {
  const queryClient = useQueryClient();
  const [step, setStep] = useState(existingConfigId ? 1 : 1);
  const [courtCount, setCourtCount] = useState(existingCourtCount || 1);
  const [groups, setGroups] = useState<CourtGroup[]>(existingGroups);
  const [courtFormats, setCourtFormats] = useState<Record<number, FormatType>>(existingCourtFormats);

  // Track which courts are being selected for a new group
  const [pendingGroup, setPendingGroup] = useState<number[]>([]);

  const allCourtNumbers = Array.from({ length: courtCount }, (_, i) => i + 1);

  // Per-unit lock helpers
  const isCourtLocked = (courtNum: number): boolean => {
    // Find actual court ID from DB courts — courtNum is 1-indexed label
    // lockedCourtIds contains DB court IDs, but we need to map court numbers to IDs
    // For now, we check if any locked court has this number in its name
    return lockedCourtIds.has(courtNum);
  };

  const isGroupLocked = (courtNumbers: number[]): boolean => {
    return courtNumbers.some((n) => lockedCourtIds.has(n));
  };

  const hasAnyLockedCourts = lockedCourtIds.size > 0;

  // Courts that are already in a group
  const groupedCourts = new Set(groups.flatMap((g) => g.courtNumbers));

  // Ungrouped courts
  const ungroupedCourts = allCourtNumbers.filter((n) => !groupedCourts.has(n));

  const togglePendingCourt = (n: number) => {
    setPendingGroup((prev) =>
      prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n]
    );
  };

  const addGroup = () => {
    if (pendingGroup.length < 2) {
      toast.error("A group must have at least 2 courts");
      return;
    }
    setGroups((prev) => [
      ...prev,
      { courtNumbers: [...pendingGroup].sort((a, b) => a - b), formatType: "mystery_partner" },
    ]);
    setPendingGroup([]);
  };

  const removeGroup = (idx: number) => {
    setGroups((prev) => prev.filter((_, i) => i !== idx));
  };

  const formatGroupLabel = (courtNumbers: number[]) => {
    if (courtNumbers.length === 2) return `Courts ${courtNumbers[0]} & ${courtNumbers[1]}`;
    const last = courtNumbers[courtNumbers.length - 1];
    const rest = courtNumbers.slice(0, -1);
    return `Courts ${rest.join(", ")} & ${last}`;
  };

  // Build items for step 3: ungrouped courts + groups
  const formatItems: { key: string; label: string; isGroup: boolean; groupIdx?: number; courtNumber?: number }[] = [];
  // Recalculate ungrouped based on current groups
  const currentGroupedCourts = new Set(groups.flatMap((g) => g.courtNumbers));
  const currentUngrouped = allCourtNumbers.filter((n) => !currentGroupedCourts.has(n));

  currentUngrouped.forEach((n) => {
    formatItems.push({ key: `court-${n}`, label: `Court ${n}`, isGroup: false, courtNumber: n });
  });
  groups.forEach((g, idx) => {
    formatItems.push({ key: `group-${idx}`, label: formatGroupLabel(g.courtNumbers), isGroup: true, groupIdx: idx });
  });

  const getFormat = (item: typeof formatItems[0]): FormatType => {
    if (item.isGroup && item.groupIdx !== undefined) {
      return groups[item.groupIdx].formatType;
    }
    if (item.courtNumber !== undefined) {
      return courtFormats[item.courtNumber] || "mystery_partner";
    }
    return "mystery_partner";
  };

  const setFormat = (item: typeof formatItems[0], format: FormatType) => {
    if (item.isGroup && item.groupIdx !== undefined) {
      setGroups((prev) =>
        prev.map((g, i) => (i === item.groupIdx ? { ...g, formatType: format } : g))
      );
    } else if (item.courtNumber !== undefined) {
      setCourtFormats((prev) => ({ ...prev, [item.courtNumber!]: format }));
    }
  };

  // Save setup
  const confirmSetup = useMutation({
    mutationFn: async () => {
      // 1. Upsert session_config
      let configId = existingConfigId;
      if (!configId) {
        const { data, error } = await supabase
          .from("session_configs" as any)
          .insert({
            city_id: cityId,
            event_id: eventId,
            location_id: locationId,
            court_count: courtCount,
            setup_completed: true,
          } as any)
          .select("id")
          .single();
        if (error) throw error;
        configId = (data as any).id;
      } else {
        const { error } = await supabase
          .from("session_configs" as any)
          .update({ court_count: courtCount, setup_completed: true } as any)
          .eq("id", configId);
        if (error) throw error;

        // Delete old groups
        await supabase
          .from("court_groups" as any)
          .delete()
          .eq("session_config_id", configId);
      }

      // 2. Create court records (upsert-style: create if not exist)
      for (let i = 1; i <= courtCount; i++) {
        const format = courtFormats[i] || "mystery_partner";
        // Check if a group overrides this court's format
        const group = groups.find((g) => g.courtNumbers.includes(i));
        const finalFormat = group ? group.formatType : format;

        // Try to find existing court for this context (scoped by location)
        let courtLookup = supabase
          .from("courts")
          .select("id")
          .eq("event_id", eventId)
          .eq("name", `Court ${i}`);
        if (locationId) {
          courtLookup = courtLookup.eq("location_id", locationId);
        } else {
          courtLookup = courtLookup.is("location_id", null);
        }
        const { data: existing } = await courtLookup.maybeSingle();

        if (locationId) {
          if (existing) {
            await supabase
              .from("courts")
              .update({ format_type: finalFormat, location_id: locationId } as any)
              .eq("id", existing.id);
          } else {
            await supabase
              .from("courts")
              .insert({
                name: `Court ${i}`,
                event_id: eventId,
                location_id: locationId,
                format_type: finalFormat,
              } as any);
          }
        } else {
          if (existing) {
            await supabase
              .from("courts")
              .update({ format_type: finalFormat } as any)
              .eq("id", existing.id);
          } else {
            await supabase
              .from("courts")
              .insert({
                name: `Court ${i}`,
                event_id: eventId,
                location_id: null,
                format_type: finalFormat,
              } as any);
          }
        }
      }

      // 3. Create court_state for each court that doesn't have one (scoped)
      let courtStateQuery = supabase
        .from("courts")
        .select("id")
        .eq("event_id", eventId);
      if (locationId) {
        courtStateQuery = courtStateQuery.eq("location_id", locationId);
      } else {
        courtStateQuery = courtStateQuery.is("location_id", null);
      }
      const { data: courts } = await courtStateQuery;

      if (courts) {
        for (const court of courts) {
          const { data: existingState } = await supabase
            .from("court_state")
            .select("court_id")
            .eq("court_id", court.id)
            .maybeSingle();

          if (!existingState) {
            await supabase.from("court_state").insert({ court_id: court.id } as any);
          }
        }
      }

      // 4. Insert court_groups
      for (const g of groups) {
        // Resolve court IDs from names
        const courtIds: number[] = [];
        for (const n of g.courtNumbers) {
          const { data: c } = await supabase
            .from("courts")
            .select("id")
            .eq("event_id", eventId)
            .eq("name", `Court ${n}`)
            .maybeSingle();
          if (c) courtIds.push(c.id);
        }

        await supabase.from("court_groups" as any).insert({
          session_config_id: configId,
          court_ids: courtIds,
          format_type: g.formatType,
        } as any);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["session_config"] });
      queryClient.invalidateQueries({ queryKey: ["courts"] });
      queryClient.invalidateQueries({ queryKey: ["court_groups"] });
      toast.success("Setup completed!");
      onComplete();
    },
    onError: (error: Error) => {
      toast.error("Failed to save setup: " + error.message);
    },
  });

  // Court count cannot be reduced below locked courts
  const maxLockedCourtNum = allCourtNumbers.filter((n) => isCourtLocked(n)).reduce((max, n) => Math.max(max, n), 0);

  return (
    <div className="space-y-6">
      {/* Step indicators */}
      <div className="flex items-center justify-center gap-2">
        {[1, 2, 3].map((s) => (
          <div
            key={s}
            className={`h-2 rounded-full transition-all ${
              s === step ? "w-8 bg-primary" : s < step ? "w-8 bg-primary/40" : "w-8 bg-muted"
            }`}
          />
        ))}
      </div>

      {/* Step 1: Court Count */}
      {step === 1 && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">How many courts will be in use today?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              type="number"
              min={Math.max(1, maxLockedCourtNum)}
              max={50}
              value={courtCount}
              onChange={(e) => {
                const v = parseInt(e.target.value) || 1;
                setCourtCount(Math.max(maxLockedCourtNum || 1, Math.min(50, v)));
              }}
              className="text-center text-2xl h-14 font-semibold"
            />
            {maxLockedCourtNum > 0 && (
              <p className="text-xs text-muted-foreground text-center">
                Cannot reduce below {maxLockedCourtNum} (locked courts exist)
              </p>
            )}
            <p className="text-sm text-muted-foreground text-center">
              Enter a number between {Math.max(1, maxLockedCourtNum)} and 50
            </p>
            <Button
              className="w-full h-12 rounded-xl"
              onClick={() => setStep(2)}
              disabled={courtCount < 1 || courtCount > 50}
            >
              Next <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Court Grouping */}
      {step === 2 && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Group Courts (Optional)</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select 2+ courts to cross-link them into a group. Ungrouped courts remain standalone.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Existing groups */}
            {groups.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Groups</p>
                {groups.map((g, idx) => {
                  const groupLocked = isGroupLocked(g.courtNumbers);
                  return (
                    <div key={idx} className={`flex items-center justify-between rounded-lg p-3 ${groupLocked ? "bg-muted/50" : "bg-secondary"}`}>
                      <span className="font-medium flex items-center gap-2">
                        {formatGroupLabel(g.courtNumbers)}
                        {groupLocked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                      </span>
                      {groupLocked ? (
                        <span className="text-xs text-muted-foreground">Locked</span>
                      ) : (
                        <Button size="icon" variant="ghost" onClick={() => removeGroup(idx)}>
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Available courts for grouping */}
            {ungroupedCourts.length >= 2 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Select courts to group</p>
                <div className="flex flex-wrap gap-2">
                  {ungroupedCourts.filter((n) => !isCourtLocked(n)).map((n) => (
                    <Badge
                      key={n}
                      variant={pendingGroup.includes(n) ? "default" : "secondary"}
                      className="cursor-pointer text-sm px-3 py-1.5 transition-all"
                      onClick={() => togglePendingCourt(n)}
                    >
                      Court {n}
                    </Badge>
                  ))}
                  {ungroupedCourts.filter((n) => isCourtLocked(n)).map((n) => (
                    <Badge
                      key={n}
                      variant="secondary"
                      className="text-sm px-3 py-1.5 opacity-50 cursor-not-allowed"
                    >
                      Court {n} <Lock className="h-3 w-3 ml-1" />
                    </Badge>
                  ))}
                </div>
                {pendingGroup.length >= 2 && (
                  <Button variant="outline" size="sm" onClick={addGroup}>
                    <Plus className="h-4 w-4 mr-1" /> Create Group
                  </Button>
                )}
              </div>
            )}

            {ungroupedCourts.length < 2 && groups.length > 0 && (
              <p className="text-sm text-muted-foreground text-center">All courts are grouped.</p>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => setStep(1)}>
                <ChevronLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button className="flex-1 h-12 rounded-xl" onClick={() => setStep(3)}>
                Next <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Format Assignment */}
      {step === 3 && (
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">Assign Formats</CardTitle>
            <p className="text-sm text-muted-foreground">
              Choose a match format for each court or group.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              {formatItems.map((item) => {
                const unitLocked = item.isGroup && item.groupIdx !== undefined
                  ? isGroupLocked(groups[item.groupIdx].courtNumbers)
                  : item.courtNumber !== undefined && isCourtLocked(item.courtNumber);

                return (
                  <div
                    key={item.key}
                    className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg p-3 ${unitLocked ? "bg-muted/50" : "bg-secondary"}`}
                  >
                    <span className="font-medium text-sm flex items-center gap-2">
                      {item.label}
                      {unitLocked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                    </span>
                    {unitLocked ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {FORMAT_OPTIONS.find(o => o.value === getFormat(item))?.label || "Mystery Partner"}
                        </span>
                        <span className="text-xs text-muted-foreground italic">Locked — reset to modify</span>
                      </div>
                    ) : (
                      <Select
                        value={getFormat(item)}
                        onValueChange={(v) => setFormat(item, v as FormatType)}
                      >
                        <SelectTrigger className="w-full sm:w-[180px] h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FORMAT_OPTIONS.map((opt) => (
                            <SelectItem
                              key={opt.value}
                              value={opt.value}
                              disabled={!opt.enabled}
                              className={!opt.enabled ? "text-muted-foreground" : ""}
                            >
                              <span className="flex items-center gap-2">
                                {opt.label}
                                {!opt.enabled && (
                                  <span className="text-xs text-muted-foreground">(coming soon)</span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => setStep(2)}>
                <ChevronLeft className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button
                className="flex-1 h-12 rounded-xl"
                onClick={() => confirmSetup.mutate()}
                disabled={confirmSetup.isPending}
              >
                {confirmSetup.isPending ? "Saving..." : "Confirm Setup"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SetupWizard;

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
  scopeEventType: 'social' | 'thursdays';
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
  scopeEventType,
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
    return lockedCourtIds.has(courtNum);
  };

  const isGroupLocked = (courtNumbers: number[]): boolean => {
    return courtNumbers.some((n) => lockedCourtIds.has(n));
  };

  const hasAnyLockedCourts = lockedCourtIds.size > 0;

  const groupedCourts = new Set(groups.flatMap((g) => g.courtNumbers));
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

  const formatItems: { key: string; label: string; isGroup: boolean; groupIdx?: number; courtNumber?: number }[] = [];
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
            event_type: scopeEventType,
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

      // 1b. Find or create session for today + scope
      const today = new Date().toISOString().split('T')[0];
      let sessionQuery = supabase
        .from("sessions" as any)
        .select("id, status")
        .eq("city_id", cityId)
        .eq("event_type", scopeEventType)
        .eq("date", today)
        .in("status", ["draft", "live"]);
      if (locationId) {
        sessionQuery = sessionQuery.eq("location_id", locationId);
      } else {
        sessionQuery = sessionQuery.is("location_id", null);
      }
      const { data: existingSessions } = await (sessionQuery as any);

      let activeSessionId: string;
      if (existingSessions && existingSessions.length > 0) {
        activeSessionId = existingSessions[0].id;
      } else {
        const { data: newSession, error: sessionError } = await supabase
          .from("sessions" as any)
          .insert({
            city_id: cityId,
            event_type: scopeEventType,
            location_id: locationId,
            date: today,
            is_active: false,
            status: "draft",
          } as any)
          .select("id")
          .single();
        if (sessionError) throw sessionError;
        activeSessionId = (newSession as any).id;
      }

      // Link session to session_config
      await supabase
        .from("session_configs" as any)
        .update({ session_id: activeSessionId } as any)
        .eq("id", configId);

      // 2. Create court records (upsert-style: create if not exist)
      for (let i = 1; i <= courtCount; i++) {
        const format = courtFormats[i] || "mystery_partner";
        const group = groups.find((g) => g.courtNumbers.includes(i));
        const finalFormat = group ? group.formatType : format;

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

        if (existing) {
          await supabase
            .from("courts")
            .update({ format_type: finalFormat, location_id: locationId || null } as any)
            .eq("id", existing.id);
        } else {
          await supabase
            .from("courts")
            .insert({
              name: `Court ${i}`,
              event_id: eventId,
              location_id: locationId || null,
              format_type: finalFormat,
            } as any);
        }
      }

      // 3. Create court_state for each court that doesn't have one
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

      // 4. Insert court_groups and collect their IDs for linking to court_units
      const groupIdMap = new Map<number, string>(); // group index -> court_groups.id
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
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

        const { data: insertedGroup, error: groupError } = await supabase.from("court_groups" as any).insert({
          session_config_id: configId,
          court_ids: courtIds,
          format_type: g.formatType,
          session_id: activeSessionId,
        } as any).select("id").single();
        if (groupError) throw groupError;
        groupIdMap.set(gi, (insertedGroup as any).id);
      }

      // 5. Upsert court_units for this scope
      // Delete non-locked court_units for this scope first
      let deleteQuery = supabase
        .from("court_units" as any)
        .delete()
        .eq("city_id", cityId)
        .eq("event_type", scopeEventType)
        .eq("is_locked", false);
      if (locationId) {
        deleteQuery = deleteQuery.eq("location_id", locationId);
      } else {
        deleteQuery = deleteQuery.is("location_id", null);
      }
      await deleteQuery;

      // Re-fetch courts to get IDs for linking
      let courtsFetch = supabase
        .from("courts")
        .select("id, name")
        .eq("event_id", eventId);
      if (locationId) {
        courtsFetch = courtsFetch.eq("location_id", locationId);
      } else {
        courtsFetch = courtsFetch.is("location_id", null);
      }
      const { data: allCourts } = await courtsFetch;
      const courtNameToId = new Map<string, number>();
      (allCourts || []).forEach((c: any) => {
        courtNameToId.set(c.name, c.id);
      });

      // Insert court_units for individual courts
      for (let i = 1; i <= courtCount; i++) {
        const courtId = courtNameToId.get(`Court ${i}`);
        const group = groups.find((g) => g.courtNumbers.includes(i));
        const finalFormat = group ? group.formatType : (courtFormats[i] || "mystery_partner");

        // Check if a locked unit exists for this court_number
        let existingCheck = supabase
          .from("court_units" as any)
          .select("id")
          .eq("city_id", cityId)
          .eq("event_type", scopeEventType)
          .eq("type", "court")
          .eq("court_number", i)
          .eq("is_locked", true);
        if (locationId) {
          existingCheck = existingCheck.eq("location_id", locationId);
        } else {
          existingCheck = existingCheck.is("location_id", null);
        }
        const { data: lockedUnit } = await existingCheck.maybeSingle();

        if (!lockedUnit) {
          await supabase.from("court_units" as any).insert({
            city_id: cityId,
            event_type: scopeEventType,
            location_id: locationId,
            type: "court",
            court_number: i,
            display_name: `Court ${i}`,
            format_type: finalFormat,
            court_id: courtId || null,
          } as any);
        }
      }

      // Insert court_units for groups (with court_group_id link)
      for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const nums = g.courtNumbers;
        let displayName: string;
        if (nums.length === 2) {
          displayName = `Courts ${nums[0]} & ${nums[1]}`;
        } else {
          const last = nums[nums.length - 1];
          const rest = nums.slice(0, -1);
          displayName = `Courts ${rest.join(", ")} & ${last}`;
        }

        await supabase.from("court_units" as any).insert({
          city_id: cityId,
          event_type: scopeEventType,
          location_id: locationId,
          type: "group",
          group_court_numbers: nums,
          display_name: displayName,
          format_type: g.formatType,
          court_group_id: groupIdMap.get(gi) || null,
        } as any);
      }

      // 6. Link all courts to this session
      let courtsToLink = supabase
        .from("courts")
        .select("id")
        .eq("event_id", eventId);
      if (locationId) {
        courtsToLink = courtsToLink.eq("location_id", locationId);
      } else {
        courtsToLink = courtsToLink.is("location_id", null);
      }
      const { data: courtsToLinkData } = await courtsToLink;
      if (courtsToLinkData) {
        for (const court of courtsToLinkData) {
          await supabase
            .from("courts")
            .update({ session_id: activeSessionId } as any)
            .eq("id", (court as any).id);
        }
      }

      return activeSessionId;
    },
    onSuccess: (sessionId: string) => {
      localStorage.setItem("gp_session_id", sessionId);
      queryClient.invalidateQueries({ queryKey: ["session_config"] });
      queryClient.invalidateQueries({ queryKey: ["courts"] });
      queryClient.invalidateQueries({ queryKey: ["court_groups"] });
      queryClient.invalidateQueries({ queryKey: ["court_units"] });
      queryClient.invalidateQueries({ queryKey: ["active_session"] });
      toast.success("Setup completed!");
      onComplete();
    },
    onError: (error: Error) => {
      toast.error("Failed to save setup: " + error.message);
    },
  });

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

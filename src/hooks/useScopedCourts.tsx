import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEventContext } from "@/hooks/useEventContext";
import { useActiveSession } from "@/hooks/useActiveSession";

export interface ScopeKey {
  cityId: string;
  eventType: "social" | "thursdays";
  locationId: string | null;
}

interface SessionConfig {
  id: string;
  city_id: string;
  event_id: string;
  event_type: "social" | "thursdays";
  location_id: string | null;
  court_count: number;
  setup_completed: boolean;
  session_id: string | null;
}

interface CourtUnit {
  id: string;
  city_id: string;
  event_type: "social" | "thursdays";
  location_id: string | null;
  session_id: string | null;
  type: "court" | "group";
  court_number: number | null;
  group_court_numbers: number[] | null;
  display_name: string;
  format_type: string;
  is_locked: boolean;
  court_id: number | null;
  court_group_id: string | null;
}

export interface RenderItem {
  key: string;
  label: string;
  type: "court" | "group";
  courtNumber?: number;
  courtNumbers?: number[];
  unitId?: string;
  courtId?: number | null;
  formatType?: string;
  courtGroupId?: string | null;
}

export function computeRenderItems(
  courtCount: number,
  courtUnits: CourtUnit[],
): { items: RenderItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const N = courtCount;
  const courtTypeUnits = courtUnits.filter((u) => u.type === "court");
  const groupTypeUnits = courtUnits.filter((u) => u.type === "group");
  const groupedCourtNumbers = new Set<number>();
  const seenGroupNumbers = new Set<number>();

  groupTypeUnits.forEach((g) => {
    (g.group_court_numbers || []).forEach((n) => {
      if (n > N) {
        warnings.push(`Group "${g.display_name}" references court ${n} which exceeds court_count ${N}.`);
        return;
      }
      if (seenGroupNumbers.has(n)) warnings.push(`Court ${n} appears in multiple groups (overlap detected).`);
      seenGroupNumbers.add(n);
      groupedCourtNumbers.add(n);
    });
  });

  const ungroupedUnits = courtTypeUnits
    .filter((u) => u.court_number !== null && u.court_number <= N && !groupedCourtNumbers.has(u.court_number!))
    .sort((a, b) => (a.court_number || 0) - (b.court_number || 0));

  const sortedGroups = [...groupTypeUnits]
    .map((g) => ({
      ...g,
      validNumbers: (g.group_court_numbers || []).filter((n) => n <= N).sort((a, b) => a - b),
    }))
    .filter((g) => g.validNumbers.length > 0)
    .sort((a, b) => Math.min(...a.validNumbers) - Math.min(...b.validNumbers));

  const items: RenderItem[] = [];
  ungroupedUnits.forEach((u) => {
    items.push({
      key: `court-${u.id}`,
      label: u.display_name,
      type: "court",
      courtNumber: u.court_number!,
      unitId: u.id,
      courtId: u.court_id,
      formatType: u.format_type,
    });
  });

  sortedGroups.forEach((g) => {
    const nums = g.validNumbers.map(String);
    let label: string;
    if (nums.length === 1) label = `Court ${nums[0]}`;
    else if (nums.length === 2) label = `Courts ${nums[0]} & ${nums[1]}`;
    else {
      const last = nums[nums.length - 1];
      label = `Courts ${nums.slice(0, -1).join(", ")} & ${last}`;
    }
    items.push({
      key: `group-${g.id}`,
      label,
      type: "group",
      courtNumbers: g.validNumbers,
      unitId: g.id,
      courtGroupId: g.court_group_id || null,
    });
  });

  return { items, warnings };
}

export function useScopedCourts() {
  const {
    selectedCityId,
    selectedLocationId,
    scopeEventType,
    isContextValid,
  } = useEventContext();
  const { activeSession, sessionLoading } = useActiveSession();

  // Only draft/live sessions own mutable setup. Ended sessions are archive-only.
  const displaySessionId = activeSession?.id || null;
  const workingSessionId =
    activeSession && (activeSession.status === "draft" || activeSession.status === "live")
      ? activeSession.id
      : null;

  const { data: sessionConfig, isLoading: configLoading } = useQuery({
    queryKey: ["session_config", displaySessionId],
    queryFn: async () => {
      if (!displaySessionId) return null;
      const { data, error } = await supabase
        .from("session_configs" as any)
        .select("*")
        .eq("session_id", displaySessionId)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as SessionConfig | null;
    },
    enabled: isContextValid && !sessionLoading,
    refetchInterval: 10_000,
  });

  const { data: courtUnits = [] } = useQuery({
    queryKey: ["court_units", displaySessionId],
    queryFn: async () => {
      if (!displaySessionId) return [];
      const { data, error } = await supabase
        .from("court_units" as any)
        .select("*")
        .eq("session_id", displaySessionId)
        .order("court_number", { nullsFirst: false });
      if (error) throw error;
      return (data || []) as unknown as CourtUnit[];
    },
    enabled: isContextValid && !!displaySessionId && !!sessionConfig?.setup_completed,
    refetchInterval: 10_000,
  });

  const courtCount = sessionConfig?.court_count || 0;
  const setupCompleted = sessionConfig?.setup_completed === true;
  const { items: renderItems, warnings } = setupCompleted
    ? computeRenderItems(courtCount, courtUnits)
    : { items: [] as RenderItem[], warnings: [] as string[] };

  return {
    sessionConfig,
    configLoading: configLoading || sessionLoading,
    courtUnits,
    courtCount,
    setupCompleted,
    renderItems,
    warnings,
    workingSessionId,
    displaySessionId,
    scopeKey: {
      cityId: selectedCityId,
      eventType: scopeEventType,
      locationId: selectedLocationId,
    } as ScopeKey,
  };
}

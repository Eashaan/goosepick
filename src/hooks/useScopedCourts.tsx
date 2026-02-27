import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEventContext } from "@/hooks/useEventContext";

// ── Types ──────────────────────────────────────────────
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
}

interface CourtUnit {
  id: string;
  city_id: string;
  event_type: "social" | "thursdays";
  location_id: string | null;
  type: "court" | "group";
  court_number: number | null;
  group_court_numbers: number[] | null;
  display_name: string;
  format_type: string;
  is_locked: boolean;
  court_id: number | null;
  court_group_id: string | null;
}

// ── Render item shared between Admin + Public ──────────
export interface RenderItem {
  key: string;
  label: string;
  type: "court" | "group";
  courtNumber?: number;
  courtNumbers?: number[];
  unitId?: string;          // court_unit id
  courtId?: number | null;  // linked courts.id
  formatType?: string;
  courtGroupId?: string | null; // direct link to court_groups.id
}

// ── Pure computation (shared logic) ────────────────────
export function computeRenderItems(
  courtCount: number,
  courtUnits: CourtUnit[],
): { items: RenderItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const N = courtCount;

  const courtTypeUnits = courtUnits.filter((u) => u.type === "court");
  const groupTypeUnits = courtUnits.filter((u) => u.type === "group");

  // Grouped court numbers (flattened from all groups)
  const groupedCourtNumbers = new Set<number>();
  const seenGroupNumbers = new Set<number>();

  groupTypeUnits.forEach((g) => {
    (g.group_court_numbers || []).forEach((n) => {
      if (n > N) {
        warnings.push(`Group "${g.display_name}" references court ${n} which exceeds court_count ${N}.`);
        return;
      }
      if (seenGroupNumbers.has(n)) {
        warnings.push(`Court ${n} appears in multiple groups (overlap detected).`);
      }
      seenGroupNumbers.add(n);
      groupedCourtNumbers.add(n);
    });
  });

  // Ungrouped = court-type units whose court_number is in [1..N] and NOT in any group
  const ungroupedUnits = courtTypeUnits
    .filter((u) => u.court_number !== null && u.court_number <= N && !groupedCourtNumbers.has(u.court_number!))
    .sort((a, b) => (a.court_number || 0) - (b.court_number || 0));

  // Groups sorted by min court number, filtering out-of-range numbers
  const sortedGroups = [...groupTypeUnits]
    .map((g) => ({
      ...g,
      validNumbers: (g.group_court_numbers || []).filter((n) => n <= N).sort((a, b) => a - b),
    }))
    .filter((g) => g.validNumbers.length > 0)
    .sort((a, b) => Math.min(...a.validNumbers) - Math.min(...b.validNumbers));

  const items: RenderItem[] = [];

  // 1. Ungrouped courts ascending
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

  // 2. Groups
  sortedGroups.forEach((g) => {
    const nums = g.validNumbers.map(String);
    let label: string;
    if (nums.length === 1) {
      label = `Court ${nums[0]}`;
    } else if (nums.length === 2) {
      label = `Courts ${nums[0]} & ${nums[1]}`;
    } else {
      const last = nums[nums.length - 1];
      const rest = nums.slice(0, -1);
      label = `Courts ${rest.join(", ")} & ${last}`;
    }
    items.push({
      key: `group-${g.id}`,
      label,
      type: "group",
      courtNumbers: g.validNumbers,
      unitId: g.id,
    });
  });

  return { items, warnings };
}

// ── Hook: fetch session_config + court_units for active scope ──
export function useScopedCourts() {
  const {
    selectedCityId,
    selectedEventId,
    selectedLocationId,
    scopeEventType,
    isContextValid,
  } = useEventContext();

  // 1. Fetch session_config
  const {
    data: sessionConfig,
    isLoading: configLoading,
  } = useQuery({
    queryKey: ["session_config", selectedCityId, scopeEventType, selectedLocationId],
    queryFn: async () => {
      let query = supabase
        .from("session_configs" as any)
        .select("*")
        .eq("city_id", selectedCityId)
        .eq("event_type", scopeEventType!);

      if (selectedLocationId) {
        query = query.eq("location_id", selectedLocationId);
      } else {
        query = query.is("location_id", null);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data as unknown as SessionConfig | null;
    },
    enabled: isContextValid && !!scopeEventType,
    refetchInterval: 10_000, // lightweight polling for cross-tab sync
  });

  // 2. Fetch court_units
  const { data: courtUnits = [] } = useQuery({
    queryKey: ["court_units", selectedCityId, scopeEventType, selectedLocationId],
    queryFn: async () => {
      let query = supabase
        .from("court_units" as any)
        .select("*")
        .eq("city_id", selectedCityId)
        .eq("event_type", scopeEventType!);

      if (selectedLocationId) {
        query = query.eq("location_id", selectedLocationId);
      } else {
        query = query.is("location_id", null);
      }

      const { data, error } = await (query as any).order("court_number", { nullsFirst: false });
      if (error) throw error;
      return (data || []) as unknown as CourtUnit[];
    },
    enabled: isContextValid && !!scopeEventType && !!sessionConfig?.setup_completed,
    refetchInterval: 10_000,
  });

  // 3. Compute render items
  const courtCount = sessionConfig?.court_count || 0;
  const setupCompleted = sessionConfig?.setup_completed === true;
  const { items: renderItems, warnings } = setupCompleted
    ? computeRenderItems(courtCount, courtUnits)
    : { items: [] as RenderItem[], warnings: [] as string[] };

  return {
    sessionConfig,
    configLoading,
    courtUnits,
    courtCount,
    setupCompleted,
    renderItems,
    warnings,
    scopeKey: {
      cityId: selectedCityId,
      eventType: scopeEventType,
      locationId: selectedLocationId,
    } as ScopeKey,
  };
}

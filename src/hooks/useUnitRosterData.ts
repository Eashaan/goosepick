import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Read + realtime hooks for ONE roster unit (an ungrouped court or a court
 * group) in an explicitly given session.
 *
 * The legacy /public pages resolve their session from the event context; the
 * participant experience page already knows the session from the registration,
 * so these hooks take it as an argument. Query keys deliberately mirror the
 * public pages so realtime invalidations and cache entries are shared.
 */

interface UnitArgs {
  sessionId: string | null | undefined;
  enabled?: boolean;
}

export function useCourtRosterData({ courtId, sessionId, enabled = true }: UnitArgs & { courtId: number | null | undefined }) {
  const queryClient = useQueryClient();
  const ready = enabled && courtId != null && Boolean(sessionId);

  const players = useQuery({
    queryKey: ["players", courtId, sessionId],
    enabled: ready,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("court_id", courtId!)
        .eq("session_id", sessionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const matches = useQuery({
    queryKey: ["matches", courtId, sessionId],
    enabled: ready,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("court_id", courtId!)
        .eq("session_id", sessionId!)
        .order("match_index", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const courtState = useQuery({
    queryKey: ["court_state", courtId, sessionId],
    enabled: ready,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("court_state")
        .select("*")
        .eq("court_id", courtId!)
        .eq("session_id", sessionId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const courtDetails = useQuery({
    queryKey: ["court_details", courtId],
    enabled: enabled && courtId != null,
    queryFn: async () => {
      const { data, error } = await supabase.from("courts").select("*").eq("id", courtId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel(`court-${courtId}-${sessionId}-participant`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "court_state", filter: `court_id=eq.${courtId}` },
        () => queryClient.invalidateQueries({ queryKey: ["court_state", courtId, sessionId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `court_id=eq.${courtId}` },
        () => queryClient.invalidateQueries({ queryKey: ["matches", courtId, sessionId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `court_id=eq.${courtId}` },
        () => queryClient.invalidateQueries({ queryKey: ["players", courtId, sessionId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ready, courtId, sessionId, queryClient]);

  return {
    players: players.data ?? [],
    matches: matches.data ?? [],
    courtState: courtState.data ?? undefined,
    courtDetails: courtDetails.data ?? null,
    isLoading: ready && (players.isLoading || matches.isLoading || courtState.isLoading),
  };
}

export function useGroupRosterData({ groupId, sessionId, enabled = true }: UnitArgs & { groupId: string | null | undefined }) {
  const queryClient = useQueryClient();
  const ready = enabled && Boolean(groupId) && Boolean(sessionId);

  const group = useQuery({
    queryKey: ["court_group_direct", groupId],
    enabled: enabled && Boolean(groupId),
    queryFn: async () => {
      const { data, error } = await supabase.from("court_groups").select("*").eq("id", groupId!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const players = useQuery({
    queryKey: ["group_players", groupId, sessionId],
    enabled: ready,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("group_id", groupId!)
        .eq("session_id", sessionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const matches = useQuery({
    queryKey: ["group_matches", groupId, sessionId],
    enabled: ready,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("group_id", groupId!)
        .eq("session_id", sessionId!)
        .order("global_match_index", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const courtStates = useQuery({
    queryKey: ["group_court_state", groupId, sessionId],
    enabled: ready,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("group_court_state")
        .select("*")
        .eq("group_id", groupId!)
        .eq("session_id", sessionId!)
        .order("court_number", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const groupCourtUnit = useQuery({
    queryKey: ["court_unit_for_group", groupId],
    enabled: enabled && Boolean(groupId),
    queryFn: async () => {
      const { data } = await supabase
        .from("court_units")
        .select("group_court_numbers")
        .eq("court_group_id", groupId!)
        .maybeSingle();
      return (data as { group_court_numbers: number[] | null } | null) ?? null;
    },
  });

  useEffect(() => {
    if (!ready) return;
    const channel = supabase
      .channel(`group-${groupId}-${sessionId}-participant`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "group_court_state", filter: `group_id=eq.${groupId}` },
        () => queryClient.invalidateQueries({ queryKey: ["group_court_state", groupId, sessionId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `group_id=eq.${groupId}` },
        () => queryClient.invalidateQueries({ queryKey: ["group_matches", groupId, sessionId] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `group_id=eq.${groupId}` },
        () => queryClient.invalidateQueries({ queryKey: ["group_players", groupId, sessionId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ready, groupId, sessionId, queryClient]);

  return {
    group: group.data ?? null,
    players: players.data ?? [],
    matches: matches.data ?? [],
    courtStates: courtStates.data ?? [],
    groupCourtNumbers: groupCourtUnit.data?.group_court_numbers ?? null,
    isLoading: ready && (group.isLoading || players.isLoading || matches.isLoading || courtStates.isLoading),
  };
}

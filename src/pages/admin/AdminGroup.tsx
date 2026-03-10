import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ChevronLeft, ChevronDown, ChevronUp, Plus, Trash2, Edit2, Check, X, Info } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import AdminContextBanner from "@/components/admin/AdminContextBanner";
import FormatSelector from "@/components/admin/FormatSelector";
import PlayerSwapModal from "@/components/admin/PlayerSwapModal";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useActiveSession } from "@/hooks/useActiveSession";
import { Database } from "@/integrations/supabase/types";

type FormatType = Database["public"]["Enums"]["format_type"];
type Match = Database["public"]["Tables"]["matches"]["Row"];


interface GroupCourtState {
  id: string;
  session_id: string | null;
  group_id: string;
  court_number: number;
  current_match_global_index: number | null;
  current_match_id: string | null;
  is_live: boolean;
  updated_at: string;
}

interface Player {
  id: string;
  name: string;
  court_id: number | null;
  group_id: string | null;
  is_guest: boolean;
  added_by_admin: boolean;
}

const DURATION_OPTIONS = [
  { value: "1.5", label: "1.5 hours" },
  { value: "2", label: "2 hours" },
  { value: "2.5", label: "2.5 hours" },
  { value: "3", label: "3 hours" },
];

const RATE_OPTIONS = [
  { value: "6", label: "Rally15 — 6/hr" },
  { value: "4", label: "Rally21 — 4/hr" },
  { value: "3", label: "Service11 — 3/hr" },
];

const AdminGroup = () => {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, isLoading: authLoading } = useAdminAuth();
  const { sessionId } = useActiveSession();

  // Player management state
  const [newPlayerName, setNewPlayerName] = useState("");
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [playersOpen, setPlayersOpen] = useState(true);

  // Reset state
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");

  // Per-panel score inputs: { [courtNumber]: { team1: string, team2: string } }
  const [panelScores, setPanelScores] = useState<Record<number, { team1: string; team2: string }>>({});
  // Per-panel override match selection
  const [panelOverrides, setPanelOverrides] = useState<Record<number, string | null>>({});

  // Swap modal state
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapMatchId, setSwapMatchId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAdmin) navigate("/admin/login");
  }, [authLoading, isAdmin, navigate]);

  // ── Fetch group ──
  const { data: group, isLoading: groupLoading } = useQuery({
    queryKey: ["court_group", groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("court_groups")
        .select("*")
        .eq("id", groupId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!groupId,
  });

  const courtNumbers: number[] = group?.court_ids || [];
  const N = courtNumbers.length;
  // Map raw court_id → local 1-indexed display number
  const courtDisplayNumber = (cn: number): number => courtNumbers.indexOf(cn) + 1;

  // ── Fetch players ──
  const { data: players = [], isLoading: playersLoading } = useQuery({
    queryKey: ["group_players", groupId, sessionId],
    queryFn: async () => {
      let query = supabase
        .from("players")
        .select("*")
        .eq("group_id", groupId!)
        .order("created_at", { ascending: true });
      if (sessionId) query = query.eq("session_id", sessionId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as Player[];
    },
    enabled: !!groupId,
  });

  // ── Fetch matches ──
  const { data: matches = [] } = useQuery({
    queryKey: ["group_matches", groupId, sessionId],
    queryFn: async () => {
      let query = supabase
        .from("matches")
        .select("*")
        .eq("group_id", groupId!)
        .order("global_match_index", { ascending: true });
      if (sessionId) query = query.eq("session_id", sessionId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as Match[];
    },
    enabled: !!groupId,
  });

  // ── Fetch group_court_state ──
  const { data: courtStates = [] } = useQuery({
    queryKey: ["group_court_state", groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("group_court_state" as any)
        .select("*")
        .eq("group_id", groupId!);
      if (error) throw error;
      return (data || []) as unknown as GroupCourtState[];
    },
    enabled: !!groupId,
  });

  // Realtime subscriptions
  useEffect(() => {
    if (!groupId) return;
    const channel = supabase
      .channel(`admin-group-${groupId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => {
        queryClient.invalidateQueries({ queryKey: ["group_matches", groupId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "group_court_state" }, () => {
        queryClient.invalidateQueries({ queryKey: ["group_court_state", groupId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, () => {
        queryClient.invalidateQueries({ queryKey: ["group_players", groupId] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [groupId, queryClient]);

  // ── Config state ──
  const [durationHours, setDurationHours] = useState<string>(String(group?.duration_hours || "2"));
  const [matchesPerHour, setMatchesPerHour] = useState<string>(String(group?.matches_per_hour || "6"));

  useEffect(() => {
    if (group) {
      setDurationHours(String(group.duration_hours || 2));
      setMatchesPerHour(String(group.matches_per_hour || 6));
    }
  }, [group]);

  const totalMatches = Math.round(parseFloat(durationHours) * parseInt(matchesPerHour) * N);
  const currentFormat: FormatType = (group?.format_type as FormatType) || "mystery_partner";
  const isFormatEnabled = currentFormat === "mystery_partner";
  const hasRotation = matches.length > 0;
  const minPlayers = 4 * N;
  const maxPlayers = 8 * N;
  const canGenerate = isFormatEnabled && players.length >= minPlayers && players.length <= maxPlayers && !hasRotation;

  // ── Helpers ──
  const getPlayerName = (id: string | null) => {
    if (!id) return "—";
    return players.find(p => p.id === id)?.name || "—";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-500">Done</span>;
      case "in_progress":
        return <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">Live</span>;
      default:
        return <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">Pending</span>;
    }
  };

  // ── Mutations ──
  const addPlayer = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase
        .from("players")
        .insert({
          group_id: groupId!,
          court_id: null as any,
          name: name.trim(),
          session_id: sessionId,
          added_by_admin: true,
        } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group_players", groupId] });
      setNewPlayerName("");
      toast.success("Player added");
    },
    onError: (err: Error) => {
      toast.error(err.message.includes("duplicate") ? "Name already exists" : "Failed to add");
    },
  });

  const updatePlayer = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("players").update({ name: name.trim() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group_players", groupId] });
      setEditingPlayerId(null);
      toast.success("Player updated");
    },
  });

  const deletePlayer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("players").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group_players", groupId] });
      toast.success("Player removed");
    },
  });

  // Save group config
  const saveConfig = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("court_groups")
        .update({
          duration_hours: parseFloat(durationHours),
          matches_per_hour: parseInt(matchesPerHour),
          total_matches: totalMatches,
        } as any)
        .eq("id", groupId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["court_group", groupId] });
      toast.success("Config saved");
    },
  });

  // Reset state includes clearPlayers checkbox
  const [clearPlayersOnReset, setClearPlayersOnReset] = useState(false);

  // Generate rotation
  const generateRotation = useMutation({
    mutationFn: async () => {
      // Save config first
      await saveConfig.mutateAsync();
      const { data, error } = await supabase.functions.invoke("generate-group-rotation", {
        body: { groupId, sessionId },
      });
      if (error) throw new Error(error.message || "Network error calling rotation function");
      return data;
    },
    onSuccess: (data: any) => {
      if (!data?.ok) {
        const msg = data?.message || data?.error || "Failed to generate";
        toast.error(`Failed: ${msg}`);
        if (data?.details) console.error("Rotation error details:", data.details);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["group_matches", groupId] });
      queryClient.invalidateQueries({ queryKey: ["group_court_state", groupId] });
      queryClient.invalidateQueries({ queryKey: ["court_group", groupId] });
      setPlayersOpen(false);
      if (data.generation_mode?.includes("fallback")) {
        toast.info("Rotation generated in Basic Mode");
      } else {
        toast.success("Rotation generated!");
      }
    },
    onError: (err: Error) => toast.error(`Failed to generate rotation: ${err.message}`),
  });

  // Reset group via edge function
  const resetGroup = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("reset-group", {
        body: { groupId, sessionId, clearPlayers: clearPlayersOnReset },
      });
      if (error) throw new Error(error.message || "Network error");
      if (!data?.ok) throw new Error(data?.message || "Reset failed");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group_matches", groupId] });
      queryClient.invalidateQueries({ queryKey: ["group_players", groupId] });
      queryClient.invalidateQueries({ queryKey: ["group_court_state", groupId] });
      queryClient.invalidateQueries({ queryKey: ["court_group", groupId] });
      setShowResetDialog(false);
      setResetPhrase("");
      setPlayersOpen(true);
      setClearPlayersOnReset(false);
      toast.success("Group reset");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Start match on a panel
  const startMatchOnPanel = useMutation({
    mutationFn: async ({ courtNumber, matchId }: { courtNumber: number; matchId: string }) => {
      const match = matches.find(m => m.id === matchId);
      if (!match) throw new Error("Match not found");

      // Check no player in this match is currently playing elsewhere
      const playerIds = [match.team1_player1_id, match.team1_player2_id, match.team2_player1_id, match.team2_player2_id].filter(Boolean);
      const liveMatches = matches.filter(m => m.status === "in_progress" && m.id !== matchId);
      for (const lm of liveMatches) {
        const livePlayerIds = [lm.team1_player1_id, lm.team1_player2_id, lm.team2_player1_id, lm.team2_player2_id];
        for (const pid of playerIds) {
          if (livePlayerIds.includes(pid)) {
            throw new Error(`${getPlayerName(pid)} is currently playing on another court`);
          }
        }
      }

      // Update match to in_progress
      const { error: matchErr } = await supabase
        .from("matches")
        .update({ status: "in_progress", started_at: new Date().toISOString() })
        .eq("id", matchId)
        .eq("status", "pending");
      if (matchErr) throw matchErr;

      // Update group_court_state
      const { error: stateErr } = await supabase
        .from("group_court_state" as any)
        .update({
          current_match_id: matchId,
          current_match_global_index: match.global_match_index,
          is_live: true,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("group_id", groupId!)
        .eq("court_number", courtNumber);
      if (stateErr) throw stateErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group_matches", groupId] });
      queryClient.invalidateQueries({ queryKey: ["group_court_state", groupId] });
      toast.success("Match started");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // End match on a panel
  const endMatchOnPanel = useMutation({
    mutationFn: async ({ courtNumber, matchId, team1Score, team2Score }: {
      courtNumber: number; matchId: string; team1Score: number; team2Score: number;
    }) => {
      const { error: matchErr } = await supabase
        .from("matches")
        .update({
          status: "completed",
          team1_score: team1Score,
          team2_score: team2Score,
          completed_at: new Date().toISOString(),
        })
        .eq("id", matchId);
      if (matchErr) throw matchErr;

      const { error: stateErr } = await supabase
        .from("group_court_state" as any)
        .update({
          current_match_id: null,
          current_match_global_index: null,
          is_live: false,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("group_id", groupId!)
        .eq("court_number", courtNumber);
      if (stateErr) throw stateErr;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["group_matches", groupId] });
      queryClient.invalidateQueries({ queryKey: ["group_court_state", groupId] });
      setPanelScores(prev => ({ ...prev, [vars.courtNumber]: { team1: "", team2: "" } }));
      toast.success("Match completed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // ── Per-panel logic ──
  const getStateForCourt = (cn: number): GroupCourtState | undefined =>
    courtStates.find(s => s.court_number === cn);

  const getActiveMatchForCourt = (cn: number): Match | undefined => {
    const state = getStateForCourt(cn);
    if (!state?.current_match_id) return undefined;
    return matches.find(m => m.id === state.current_match_id && m.status === "in_progress");
  };

  const getSuggestedMatch = (cn: number): Match | undefined => {
    // Override selection?
    const override = panelOverrides[cn];
    if (override) {
      const m = matches.find(m => m.id === override && m.status === "pending");
      if (m) return m;
    }
    // Earliest pending not active on another panel
    const activeMIds = new Set(courtStates.filter(s => s.is_live && s.current_match_id).map(s => s.current_match_id));
    return matches.find(m => m.status === "pending" && !activeMIds.has(m.id));
  };

  const getAvailableMatches = (cn: number): Match[] => {
    const activeMIds = new Set(courtStates.filter(s => s.is_live && s.current_match_id).map(s => s.current_match_id));
    return matches.filter(m => m.status === "pending" && !activeMIds.has(m.id));
  };

  // Group label
  const displayNumbers = courtNumbers.map((_, i) => i + 1);
  const groupLabel = displayNumbers.length <= 2
    ? `Courts ${displayNumbers.join(" & ")}`
    : `Courts ${displayNumbers.slice(0, -1).join(", ")} & ${displayNumbers[displayNumbers.length - 1]}`;

  if (authLoading || groupLoading) {
    return (
      <PageLayout><GlobalHeader />
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <GlobalHeader />
      <AdminContextBanner courtName={groupLabel} />
      <div className="min-h-screen px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-2xl">
          {/* Header */}
          <div className="mb-6 flex items-center gap-4">
            <Button asChild variant="ghost" size="icon" className="shrink-0">
              <Link to="/admin"><ChevronLeft className="h-6 w-6" /></Link>
            </Button>
            <h1 className="text-2xl font-bold">{groupLabel}</h1>
          </div>

          {/* Format selector */}
          <div className="mb-6">
            <FormatSelector
              currentFormat={currentFormat}
              onFormatChange={() => {}}
              disabled={hasRotation}
              hasMatches={hasRotation}
            />
          </div>

          <Tabs defaultValue="scoring" className="space-y-6">
            <TabsList className="sticky top-0 z-20 w-full bg-secondary rounded-xl h-12">
              <TabsTrigger value="scoring" className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                Live Scoring
              </TabsTrigger>
              <TabsTrigger value="roster" className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
                Court Roster
              </TabsTrigger>
            </TabsList>

            {/* ══ Scoring Tab ══ */}
            <TabsContent value="scoring" className="space-y-6">
              {!isFormatEnabled ? (
                <Card className="bg-muted/50 border-border">
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <p className="text-lg font-medium">Format Not Available</p>
                    <p className="text-sm mt-2">Select "Mystery Partner" to use the full feature set.</p>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Group Setup */}
                  {!hasRotation && (
                    <Card className="bg-card border-border">
                      <CardHeader><CardTitle className="text-lg">Group Setup</CardTitle></CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-sm text-muted-foreground mb-1 block">Duration</label>
                            <Select value={durationHours} onValueChange={setDurationHours}>
                              <SelectTrigger className="bg-secondary"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {DURATION_OPTIONS.map(o => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <label className="text-sm text-muted-foreground mb-1 block">Match Rate</label>
                            <Select value={matchesPerHour} onValueChange={setMatchesPerHour}>
                              <SelectTrigger className="bg-secondary"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {RATE_OPTIONS.map(o => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="rounded-lg bg-secondary p-3 text-center">
                          <p className="text-sm text-muted-foreground">Total Matches</p>
                          <p className="text-2xl font-bold text-primary">{totalMatches}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            {durationHours}h × {matchesPerHour}/hr × {N} courts
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Players */}
                  <Collapsible open={playersOpen} onOpenChange={setPlayersOpen}>
                    <Card className="bg-card border-border">
                      <CollapsibleTrigger className="w-full">
                        <CardHeader className="flex flex-row items-center justify-between">
                          <CardTitle className="text-lg">
                            Players {players.length > 0 && <span className="ml-2 text-sm font-normal text-primary">({players.length})</span>}
                          </CardTitle>
                          {playersOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                        </CardHeader>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <CardContent className="space-y-4">
                          {playersLoading ? (
                            <p className="text-muted-foreground">Loading...</p>
                          ) : (
                            <div className="space-y-2">
                              {players.map(player => (
                                <div key={player.id} className="flex items-center gap-2 rounded-lg bg-secondary p-3">
                                  {editingPlayerId === player.id ? (
                                    <>
                                      <Input value={editingName} onChange={e => setEditingName(e.target.value)} className="flex-1 h-8 bg-background" autoFocus />
                                      <Button size="icon" variant="ghost" onClick={() => updatePlayer.mutate({ id: player.id, name: editingName })} disabled={!editingName.trim()}>
                                        <Check className="h-4 w-4 text-green-500" />
                                      </Button>
                                      <Button size="icon" variant="ghost" onClick={() => setEditingPlayerId(null)}>
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </>
                                  ) : (
                                    <>
                                      <span className="flex-1">
                                        {player.name}
                                        {player.is_guest && <span className="ml-2 text-xs text-muted-foreground">(Guest)</span>}
                                      </span>
                                      <Button size="icon" variant="ghost" onClick={() => { setEditingPlayerId(player.id); setEditingName(player.name); }}>
                                        <Edit2 className="h-4 w-4" />
                                      </Button>
                                      {!hasRotation && (
                                        <Button size="icon" variant="ghost" onClick={() => deletePlayer.mutate(player.id)}>
                                          <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                      )}
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          {players.length < maxPlayers && !hasRotation && (
                            <form onSubmit={e => { e.preventDefault(); if (newPlayerName.trim()) addPlayer.mutate(newPlayerName); }} className="flex gap-2">
                              <Input placeholder="Player name" value={newPlayerName} onChange={e => setNewPlayerName(e.target.value)} className="flex-1 bg-secondary" />
                              <Button type="submit" size="icon" disabled={!newPlayerName.trim()}><Plus className="h-4 w-4" /></Button>
                            </form>
                          )}

                          {players.length < minPlayers && (
                            <p className="text-sm text-muted-foreground">
                              Add {minPlayers - players.length} more player{minPlayers - players.length !== 1 ? "s" : ""} (min {minPlayers}, max {maxPlayers} for {N} courts)
                            </p>
                          )}
                        </CardContent>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>

                  {/* Generate / Match Control */}
                  {!hasRotation ? (
                    <div className="space-y-2">
                      <Button
                        onClick={() => generateRotation.mutate()}
                        disabled={!canGenerate || generateRotation.isPending}
                        className="w-full h-12 text-lg rounded-xl"
                      >
                        {generateRotation.isPending ? "Generating..." : "Generate Rotation"}
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-lg bg-muted/50 p-3 text-center">
                        <p className="text-sm text-muted-foreground">Rotation locked. Use <span className="font-semibold text-destructive">Reset Group</span> to restart.</p>
                      </div>
                      {/* ── Per-court scoring panels ── */}
                      {courtNumbers.map(cn => {
                        const state = getStateForCourt(cn);
                        const activeMatch = getActiveMatchForCourt(cn);
                        const suggested = getSuggestedMatch(cn);
                        const displayMatch = activeMatch || suggested;
                        const isLive = !!activeMatch;
                        const scores = panelScores[cn] || { team1: "", team2: "" };

                        return (
                          <Card key={cn} className={`bg-card border-border ${isLive ? "ring-1 ring-primary/40" : ""}`}>
                            <CardHeader className="pb-2">
                              <div className="flex items-center justify-between">
                                <CardTitle className="text-base">
                                  Court {cn}
                                  {isLive && <span className="ml-2 inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />}
                                </CardTitle>
                                {displayMatch && (
                                  <span className="text-xs text-muted-foreground">
                                    #{displayMatch.global_match_index}
                                  </span>
                                )}
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {displayMatch ? (
                                <>
                                  {/* Teams display */}
                                  <div className="rounded-lg bg-secondary p-3 space-y-2">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <span className="text-sm font-semibold">{getPlayerName(displayMatch.team1_player1_id)}</span>
                                      <span className="text-muted-foreground text-xs">&</span>
                                      <span className="text-sm font-semibold">{getPlayerName(displayMatch.team1_player2_id)}</span>
                                      {!isLive && displayMatch.status === "pending" && (
                                        <button
                                          className="text-xs text-primary underline ml-auto"
                                          onClick={() => {
                                            setSwapMatchId(displayMatch.id);
                                            setSwapModalOpen(true);
                                          }}
                                        >
                                          Edit Lineup
                                        </button>
                                      )}
                                    </div>
                                    <div className="text-center text-xs text-muted-foreground">vs</div>
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                      <span className="text-sm font-semibold">{getPlayerName(displayMatch.team2_player1_id)}</span>
                                      <span className="text-muted-foreground text-xs">&</span>
                                      <span className="text-sm font-semibold">{getPlayerName(displayMatch.team2_player2_id)}</span>
                                    </div>
                                  </div>

                                  {/* Override dropdown when idle */}
                                  {!isLive && getAvailableMatches(cn).length > 1 && (
                                    <Select
                                      value={panelOverrides[cn] || "default"}
                                      onValueChange={val => setPanelOverrides(prev => ({ ...prev, [cn]: val === "default" ? null : val }))}
                                    >
                                      <SelectTrigger className="bg-secondary text-xs h-8">
                                        <SelectValue placeholder="Default next" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="default">Default next match</SelectItem>
                                        {getAvailableMatches(cn).map(m => (
                                          <SelectItem key={m.id} value={m.id}>
                                            #{m.global_match_index}: {getPlayerName(m.team1_player1_id)} & {getPlayerName(m.team1_player2_id)} vs {getPlayerName(m.team2_player1_id)} & {getPlayerName(m.team2_player2_id)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  )}

                                  {/* Controls */}
                                  {!isLive && displayMatch.status === "pending" && (
                                    <Button
                                      className="w-full rounded-xl"
                                      onClick={() => startMatchOnPanel.mutate({ courtNumber: cn, matchId: displayMatch.id })}
                                      disabled={startMatchOnPanel.isPending}
                                    >
                                      Start Match
                                    </Button>
                                  )}

                                  {isLive && (
                                    <div className="space-y-3">
                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label className="text-xs text-muted-foreground mb-1 block">Team 1</label>
                                          <Input
                                            type="number" min="0"
                                            value={scores.team1}
                                            onChange={e => setPanelScores(prev => ({ ...prev, [cn]: { ...scores, team1: e.target.value } }))}
                                            className="h-10 text-center text-lg bg-secondary"
                                          />
                                        </div>
                                        <div>
                                          <label className="text-xs text-muted-foreground mb-1 block">Team 2</label>
                                          <Input
                                            type="number" min="0"
                                            value={scores.team2}
                                            onChange={e => setPanelScores(prev => ({ ...prev, [cn]: { ...scores, team2: e.target.value } }))}
                                            className="h-10 text-center text-lg bg-secondary"
                                          />
                                        </div>
                                      </div>
                                      <Button
                                        className="w-full rounded-xl"
                                        disabled={!scores.team1 || !scores.team2}
                                        onClick={() => endMatchOnPanel.mutate({
                                          courtNumber: cn,
                                          matchId: activeMatch!.id,
                                          team1Score: parseInt(scores.team1) || 0,
                                          team2Score: parseInt(scores.team2) || 0,
                                        })}
                                      >
                                        End Match
                                      </Button>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <p className="text-center text-sm text-muted-foreground py-4">
                                  All matches completed 🎉
                                </p>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </>
                  )}

                  {/* Reset */}
                  {hasRotation && (
                    <Card className="bg-card border-border">
                      <CardHeader><CardTitle className="text-lg text-destructive">Danger Zone</CardTitle></CardHeader>
                      <CardContent>
                        {!showResetDialog ? (
                          <div className="space-y-2">
                            <Button
                              variant="outline"
                              onClick={() => setShowResetDialog(true)}
                              className="w-full border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                            >
                              Reset Group
                            </Button>
                            <p className="text-xs text-muted-foreground text-center">
                              Deletes the rotation, scores, and live state for this group only. Other courts/groups remain untouched.
                            </p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                              This will delete the group rotation, scores, and live state for this group only. Other courts/groups remain untouched.
                            </p>
                            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                              <input
                                type="checkbox"
                                checked={clearPlayersOnReset}
                                onChange={e => setClearPlayersOnReset(e.target.checked)}
                                className="rounded border-border"
                              />
                              Also clear guest players
                            </label>
                            <p className="text-sm text-muted-foreground">Type <span className="font-semibold">RESET GROUP</span> to confirm</p>
                            <Input placeholder="RESET GROUP" value={resetPhrase} onChange={e => setResetPhrase(e.target.value)} className="bg-secondary" />
                            <div className="flex gap-2">
                              <Button variant="outline" onClick={() => { setShowResetDialog(false); setResetPhrase(""); setClearPlayersOnReset(false); }} className="flex-1">Cancel</Button>
                              <Button
                                variant="destructive"
                                disabled={resetGroup.isPending}
                                onClick={() => {
                                  if (resetPhrase.toUpperCase() === "RESET GROUP") resetGroup.mutate();
                                  else toast.error("Type RESET GROUP to confirm");
                                }}
                                className="flex-1"
                              >
                                {resetGroup.isPending ? "Resetting..." : "Reset Group"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            {/* ══ Roster Tab ══ */}
            <TabsContent value="roster">
              <Card className="bg-card border-border">
                <CardHeader><CardTitle className="text-lg">Full Group Roster</CardTitle></CardHeader>
                <CardContent>
                  {matches.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">Waiting for rotation...</div>
                  ) : (
                    <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-card">
                          <TableRow className="border-border">
                            <TableHead className="text-xs bg-card">Global #</TableHead>
                            <TableHead className="text-xs bg-card">Court</TableHead>
                            <TableHead className="text-xs bg-card">Team 1</TableHead>
                            <TableHead className="text-xs bg-card">Team 2</TableHead>
                            <TableHead className="text-xs text-center bg-card">Score</TableHead>
                            <TableHead className="text-xs text-center bg-card">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {matches.map(match => {
                            const isLive = match.status === "in_progress";
                            const isDone = match.status === "completed";
                            return (
                              <TableRow key={match.id} className={`border-border ${isLive ? "bg-primary/10" : isDone ? "opacity-60" : ""}`}>
                                <TableCell className={`font-medium ${isLive ? "text-primary" : ""}`}>{match.global_match_index}</TableCell>
                                <TableCell className="text-sm">{match.court_number}</TableCell>
                                <TableCell className="text-sm">
                                  <p>{getPlayerName(match.team1_player1_id)}</p>
                                  <p>{getPlayerName(match.team1_player2_id)}</p>
                                </TableCell>
                                <TableCell className="text-sm">
                                  <p>{getPlayerName(match.team2_player1_id)}</p>
                                  <p>{getPlayerName(match.team2_player2_id)}</p>
                                </TableCell>
                                <TableCell className="text-center">
                                  {isDone ? <span className="font-semibold">{match.team1_score} - {match.team2_score}</span> : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                                <TableCell className="text-center">{getStatusBadge(match.status || "pending")}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Swap modal */}
      {swapMatchId && (() => {
        const m = matches.find(m => m.id === swapMatchId);
        if (!m) return null;
        const matchPlayers = [
          { id: m.team1_player1_id!, name: getPlayerName(m.team1_player1_id), slot: "team1_player1_id" as const },
          { id: m.team1_player2_id!, name: getPlayerName(m.team1_player2_id), slot: "team1_player2_id" as const },
          { id: m.team2_player1_id!, name: getPlayerName(m.team2_player1_id), slot: "team2_player1_id" as const },
          { id: m.team2_player2_id!, name: getPlayerName(m.team2_player2_id), slot: "team2_player2_id" as const },
        ].filter(mp => !!mp.id);
        return (
          <PlayerSwapModal
            open={swapModalOpen}
            onOpenChange={(open) => {
              setSwapModalOpen(open);
              if (!open) setSwapMatchId(null);
            }}
            courtId={0}
            groupId={groupId}
            sessionId={sessionId}
            matchId={swapMatchId}
            matchPlayers={matchPlayers}
            allPlayers={players as any}
            matchPlayerIds={[m.team1_player1_id, m.team1_player2_id, m.team2_player1_id, m.team2_player2_id]}
          />
        );
      })()}
    </PageLayout>
  );
};

export default AdminGroup;

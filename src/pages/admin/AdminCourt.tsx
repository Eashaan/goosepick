import { useEffect, useState } from "react";
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
import { Database } from "@/integrations/supabase/types";
import { useAdminAuth } from "@/hooks/useAdminAuth";

type Match = Database["public"]["Tables"]["matches"]["Row"];

interface RotationDiagnostics {
  player_count: number;
  matches_per_court: number;
  min_matches_per_player: number;
  max_matches_per_player: number;
  max_sitout_streak: number;
  repeat_partner_count: number;
  back_to_back_count: number;
  attempts_full: number;
  attempts_fallback1: number;
  attempts_fallback2: number;
  used_seed: number;
  note?: string;
}

interface RotationResult {
  ok: boolean;
  generation_mode?: "full" | "fallback1" | "fallback2";
  diagnostics?: RotationDiagnostics;
  error?: string;
}

const AdminCourt = () => {
  const { courtId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const courtNumber = parseInt(courtId || "1");
  const { isAdmin, isLoading: authLoading } = useAdminAuth();

  const [newPlayerName, setNewPlayerName] = useState("");
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [playersOpen, setPlayersOpen] = useState(true);
  const [overrideMatchId, setOverrideMatchId] = useState<string | null>(null);
  const [rotationDiagnostics, setRotationDiagnostics] = useState<RotationDiagnostics | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      navigate("/admin/login");
    }
  }, [authLoading, isAdmin, navigate]);

  // Fetch players for this court
  const { data: players = [], isLoading: playersLoading } = useQuery({
    queryKey: ["players", courtNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("players")
        .select("*")
        .eq("court_id", courtNumber)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Fetch matches for this court
  const { data: matches = [] } = useQuery({
    queryKey: ["matches", courtNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*")
        .eq("court_id", courtNumber)
        .order("match_index", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Fetch court state
  const { data: courtState } = useQuery({
    queryKey: ["court_state", courtNumber],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("court_state")
        .select("*")
        .eq("court_id", courtNumber)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Set up realtime subscriptions
  useEffect(() => {
    const channel = supabase
      .channel(`admin-court-${courtNumber}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `court_id=eq.${courtNumber}` },
        () => queryClient.invalidateQueries({ queryKey: ["matches", courtNumber] })
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "court_state", filter: `court_id=eq.${courtNumber}` },
        () => queryClient.invalidateQueries({ queryKey: ["court_state", courtNumber] })
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [courtNumber, queryClient]);

  // Add player mutation
  const addPlayer = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase
        .from("players")
        .insert({ court_id: courtNumber, name: name.trim() });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["players", courtNumber] });
      setNewPlayerName("");
      toast.success("Player added");
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("Player name already exists");
      } else {
        toast.error("Failed to add player");
      }
    },
  });

  // Update player mutation
  const updatePlayer = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase
        .from("players")
        .update({ name: name.trim() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["players", courtNumber] });
      setEditingPlayerId(null);
      toast.success("Player updated");
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("Player name already exists");
      } else {
        toast.error("Failed to update player");
      }
    },
  });

  // Delete player mutation
  const deletePlayer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("players").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["players", courtNumber] });
      toast.success("Player removed");
    },
    onError: () => {
      toast.error("Failed to remove player");
    },
  });

  // Generate rotation mutation
  const generateRotation = useMutation({
    mutationFn: async (): Promise<RotationResult> => {
      const { data, error } = await supabase.functions.invoke("generate-rotation", {
        body: { courtId: courtNumber },
      });
      if (error) throw error;
      return data as RotationResult;
    },
    onSuccess: (data: RotationResult) => {
      queryClient.invalidateQueries({ queryKey: ["matches", courtNumber] });
      queryClient.invalidateQueries({ queryKey: ["court_state", courtNumber] });
      // Auto-collapse players section
      setPlayersOpen(false);
      
      if (!data.ok) {
        toast.error(data.error || "Failed to generate rotation");
        return;
      }
      
      // Store diagnostics for display
      if (data.diagnostics) {
        setRotationDiagnostics(data.diagnostics);
      }
      
      // Show appropriate toast based on generation mode
      if (data.generation_mode === "full") {
        toast.success("Rotation generated!");
      } else if (data.generation_mode === "fallback1") {
        toast.info("Rotation generated in Safe Mode (minor constraint relaxations).", {
          duration: 5000,
        });
      } else if (data.generation_mode === "fallback2") {
        toast.warning("Rotation generated in Basic Mode (best effort).", {
          duration: 5000,
        });
      }
    },
    onError: (error: Error) => {
      toast.error("Couldn't generate rotation right now. Please retry.");
      console.error("Rotation generation error:", error);
    },
  });

  // Get the in_progress match from database (single source of truth)
  const getInProgressMatch = (): Match | undefined => {
    return matches.find(m => m.status === "in_progress");
  };

  // Get the next uncompleted match (not in_progress, not completed)
  const getNextUncompletedMatch = (): Match | undefined => {
    return matches.find(m => m.status !== "completed" && m.status !== "in_progress");
  };

  // Get the match to preview in dropdown (before starting)
  const getMatchToStart = (): Match | undefined => {
    if (overrideMatchId) {
      return matches.find(m => m.id === overrideMatchId);
    }
    return getNextUncompletedMatch();
  };

  // Get uncompleted matches for override dropdown (exclude in_progress)
  const getUncompletedMatches = () => {
    return matches.filter(m => m.status !== "completed" && m.status !== "in_progress");
  };

  // The ACTIVE match being played - derived from DB status
  const activeMatch = getInProgressMatch();

  // Start match mutation
  const startMatch = useMutation({
    mutationFn: async () => {
      const matchToStart = getMatchToStart();
      if (!matchToStart) throw new Error("No match to start");

      // Update match status
      const { error: matchError } = await supabase
        .from("matches")
        .update({ 
          status: "in_progress", 
          started_at: new Date().toISOString() 
        })
        .eq("id", matchToStart.id);
      if (matchError) throw matchError;

      // Update court state
      const { error: stateError } = await supabase
        .from("court_state")
        .update({ 
          phase: "in_progress", 
          current_match_index: matchToStart.match_index,
          updated_at: new Date().toISOString() 
        })
        .eq("court_id", courtNumber);
      if (stateError) throw stateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matches", courtNumber] });
      queryClient.invalidateQueries({ queryKey: ["court_state", courtNumber] });
      setOverrideMatchId(null);
      toast.success("Match started");
    },
  });

  // End match mutation
  const endMatch = useMutation({
    mutationFn: async ({ team1Score, team2Score }: { team1Score: number; team2Score: number }) => {
      const currentMatch = matches.find(m => m.match_index === courtState?.current_match_index);
      if (!currentMatch) throw new Error("No current match found");

      const wasOverride = overrideMatchId !== null;

      // Update match scores and status
      const { error: matchError } = await supabase
        .from("matches")
        .update({ 
          team1_score: team1Score, 
          team2_score: team2Score,
          status: "completed",
          completed_at: new Date().toISOString(),
          override_played: wasOverride
        })
        .eq("id", currentMatch.id);
      if (matchError) throw matchError;

      // Find next uncompleted match
      const nextMatch = matches.find(m => 
        m.status !== "completed" && m.id !== currentMatch.id
      );
      
      const isCompleted = !nextMatch;

      const { error: stateError } = await supabase
        .from("court_state")
        .update({
          current_match_index: isCompleted ? courtState?.current_match_index : nextMatch?.match_index,
          phase: isCompleted ? "completed" : "idle",
          updated_at: new Date().toISOString(),
        })
        .eq("court_id", courtNumber);
      if (stateError) throw stateError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matches", courtNumber] });
      queryClient.invalidateQueries({ queryKey: ["court_state", courtNumber] });
      toast.success("Match completed");
    },
  });

  // Reset court mutation
  const resetCourt = useMutation({
    mutationFn: async () => {
      await supabase.from("matches").delete().eq("court_id", courtNumber);
      await supabase.from("players").delete().eq("court_id", courtNumber);
      await supabase
        .from("court_state")
        .update({ current_match_index: 0, phase: "idle", updated_at: new Date().toISOString() })
        .eq("court_id", courtNumber);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["players", courtNumber] });
      queryClient.invalidateQueries({ queryKey: ["matches", courtNumber] });
      queryClient.invalidateQueries({ queryKey: ["court_state", courtNumber] });
      setShowResetDialog(false);
      setResetPhrase("");
      setPlayersOpen(true);
      toast.success("Court reset successfully");
    },
  });

  const handleAddPlayer = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPlayerName.trim() && players.length < 12) {
      addPlayer.mutate(newPlayerName);
    }
  };

  const handleResetCourt = () => {
    const expectedPhrase = `RESET COURT ${courtNumber}`;
    if (resetPhrase.toUpperCase() === expectedPhrase) {
      resetCourt.mutate();
    } else {
      toast.error("Invalid confirmation phrase");
    }
  };

  const hasRotation = matches.length > 0;
  const canGenerateRotation = players.length >= 8 && players.length <= 12 && !hasRotation;
  const matchToStart = getMatchToStart(); // For displaying in dropdown / before start
  const currentMatch = activeMatch || matches.find(m => m.match_index === courtState?.current_match_index);
  // displayMatch: When in_progress, show the active match; otherwise show what would be started next
  const displayMatch = courtState?.phase === "in_progress" ? activeMatch : matchToStart;

  const [team1Score, setTeam1Score] = useState("");
  const [team2Score, setTeam2Score] = useState("");

  const getPlayerName = (playerId: string | null) => {
    if (!playerId) return "—";
    const player = players.find(p => p.id === playerId);
    return player?.name || "—";
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <span className="text-xs px-2 py-1 rounded-full bg-green-500/20 text-green-500">Completed</span>;
      case "in_progress":
        return <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">In Progress</span>;
      default:
        return <span className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground">Pending</span>;
    }
  };

  return (
    <PageLayout>
      <div className="min-h-screen px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-2xl">
          {/* Header */}
          <div className="mb-8 flex items-center gap-4">
            <Button asChild variant="ghost" size="icon" className="shrink-0">
              <Link to="/admin">
                <ChevronLeft className="h-6 w-6" />
              </Link>
            </Button>
            <h1 className="text-2xl font-bold">Court {courtNumber}</h1>
          </div>

          {/* Admin Tabs */}
          <Tabs defaultValue="scoring" className="space-y-6">
            <TabsList className="sticky top-0 z-20 w-full bg-secondary rounded-xl h-12">
              <TabsTrigger 
                value="scoring" 
                className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Live Scoring Inputs
              </TabsTrigger>
              <TabsTrigger 
                value="roster" 
                className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Court Roster
              </TabsTrigger>
            </TabsList>

            {/* Live Scoring Inputs Tab */}
            <TabsContent value="scoring" className="space-y-6">
              {/* Players Section (Collapsible) */}
              <Collapsible open={playersOpen} onOpenChange={setPlayersOpen}>
                <Card className="bg-card border-border">
                  <CollapsibleTrigger className="w-full">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="text-lg">
                        Players {players.length > 0 && <span className="ml-2 text-sm font-normal text-primary">({players.length})</span>}
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        {players.length > 0 && hasRotation && (
                          <p className="text-xs text-muted-foreground hidden sm:block">
                            Renaming updates displays; history unchanged.
                          </p>
                        )}
                        {playersOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="space-y-4">
                      {playersLoading ? (
                        <p className="text-muted-foreground">Loading...</p>
                      ) : (
                        <div className="space-y-2">
                          {players.map((player) => (
                            <div key={player.id} className="flex items-center gap-2 rounded-lg bg-secondary p-3">
                              {editingPlayerId === player.id ? (
                                <>
                                  <Input
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    className="flex-1 h-8 bg-background"
                                    autoFocus
                                  />
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => updatePlayer.mutate({ id: player.id, name: editingName })}
                                    disabled={!editingName.trim()}
                                  >
                                    <Check className="h-4 w-4 text-green-500" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setEditingPlayerId(null)}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <span className="flex-1">{player.name}</span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingPlayerId(player.id);
                                      setEditingName(player.name);
                                    }}
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </Button>
                                  {!hasRotation && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => deletePlayer.mutate(player.id)}
                                    >
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {players.length < 12 && !hasRotation && (
                        <form onSubmit={handleAddPlayer} className="flex gap-2">
                          <Input
                            placeholder="Player name"
                            value={newPlayerName}
                            onChange={(e) => setNewPlayerName(e.target.value)}
                            className="flex-1 bg-secondary"
                          />
                          <Button type="submit" size="icon" disabled={!newPlayerName.trim()}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </form>
                      )}

                      {players.length < 8 && (
                        <p className="text-sm text-muted-foreground">
                          Add {8 - players.length} more player{8 - players.length !== 1 ? "s" : ""} to generate rotation
                        </p>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>

              {/* Rotation & Match Control */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Match Control</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {!hasRotation ? (
                    <div className="space-y-4">
                      <Button
                        onClick={() => generateRotation.mutate()}
                        disabled={!canGenerateRotation || generateRotation.isPending}
                        className="w-full h-12 text-lg rounded-xl"
                      >
                        {generateRotation.isPending ? "Generating..." : "Generate Rotation"}
                      </Button>
                      {generateRotation.isError && (
                        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4">
                          <p className="text-sm text-destructive">
                            Couldn't generate rotation. Please try again.
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => generateRotation.mutate()}
                            className="mt-2"
                            disabled={generateRotation.isPending}
                          >
                            Retry
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Diagnostics banner (if rotation used fallback) */}
                      {rotationDiagnostics && (
                        <Collapsible open={showDiagnostics} onOpenChange={setShowDiagnostics}>
                          <div className={`rounded-lg p-3 ${
                            rotationDiagnostics.note === "emergency_basic_used" 
                              ? "bg-destructive/10 border border-destructive/20"
                              : rotationDiagnostics.attempts_fallback2 > 0
                                ? "bg-yellow-500/10 border border-yellow-500/20"
                                : rotationDiagnostics.attempts_fallback1 > 0
                                  ? "bg-blue-500/10 border border-blue-500/20"
                                  : "bg-green-500/10 border border-green-500/20"
                          }`}>
                            <CollapsibleTrigger className="flex items-center gap-2 w-full text-left">
                              <Info className="h-4 w-4" />
                              <span className="text-sm flex-1">
                                {rotationDiagnostics.note === "emergency_basic_used"
                                  ? "Basic Mode (emergency fallback)"
                                  : rotationDiagnostics.attempts_fallback2 > 0
                                    ? "Basic Mode (best effort)"
                                    : rotationDiagnostics.attempts_fallback1 > 0
                                      ? "Safe Mode (minor relaxations)"
                                      : "Full Mode (all constraints met)"}
                              </span>
                              {showDiagnostics ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </CollapsibleTrigger>
                            <CollapsibleContent className="mt-3 pt-3 border-t border-border/30">
                              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                <p>Players: {rotationDiagnostics.player_count}</p>
                                <p>Matches: {rotationDiagnostics.matches_per_court}</p>
                                <p>Min/Max per player: {rotationDiagnostics.min_matches_per_player}/{rotationDiagnostics.max_matches_per_player}</p>
                                <p>Max sit-out: {rotationDiagnostics.max_sitout_streak}</p>
                                <p>Repeat partners: {rotationDiagnostics.repeat_partner_count}</p>
                                <p>Back-to-back: {rotationDiagnostics.back_to_back_count}</p>
                                <p>Full attempts: {rotationDiagnostics.attempts_full}</p>
                                <p>Fallback attempts: {rotationDiagnostics.attempts_fallback1 + rotationDiagnostics.attempts_fallback2}</p>
                              </div>
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                      )}

                      {/* Current match info - shows ACTIVE match when in_progress */}
                      <div className="rounded-xl bg-secondary p-4">
                        <div className="mb-2 text-sm text-muted-foreground">
                          {courtState?.phase === "in_progress" && activeMatch
                            ? `Match ${activeMatch.match_index + 1} of ${matches.length}`
                            : displayMatch
                              ? `Up Next: Match ${displayMatch.match_index + 1} of ${matches.length}`
                              : `Match ${matches.length} of ${matches.length}`
                          }
                        </div>
                        {displayMatch && courtState?.phase !== "completed" ? (
                          <div className="text-lg font-semibold">
                            {getPlayerName(displayMatch.team1_player1_id)} & {getPlayerName(displayMatch.team1_player2_id)}
                            <span className="mx-2 text-muted-foreground">vs</span>
                            {getPlayerName(displayMatch.team2_player1_id)} & {getPlayerName(displayMatch.team2_player2_id)}
                          </div>
                        ) : (
                          <div className="text-lg font-semibold text-primary">Court Completed</div>
                        )}
                        <div className="mt-2 text-sm text-primary capitalize">
                          {courtState?.phase || "idle"}
                        </div>
                      </div>

                      {/* Override dropdown */}
                      {courtState?.phase === "idle" && getUncompletedMatches().length > 1 && (
                        <div className="space-y-2">
                          <label className="text-sm text-muted-foreground">Override Match (optional)</label>
                          <Select 
                            value={overrideMatchId || "default"} 
                            onValueChange={(val) => setOverrideMatchId(val === "default" ? null : val)}
                          >
                            <SelectTrigger className="bg-secondary">
                              <SelectValue placeholder="Play default next match" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Play default next match</SelectItem>
                              {getUncompletedMatches().map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  Match {m.match_index + 1}: {getPlayerName(m.team1_player1_id)} & {getPlayerName(m.team1_player2_id)} vs {getPlayerName(m.team2_player1_id)} & {getPlayerName(m.team2_player2_id)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {overrideMatchId && (
                            <p className="text-xs text-primary">
                              Override selected. This match will be skipped when its turn comes.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Match controls */}
                      {courtState?.phase === "idle" && matchToStart && (
                        <Button
                          onClick={() => startMatch.mutate()}
                          className="w-full h-12 text-lg rounded-xl"
                        >
                          Start Match {overrideMatchId ? `(#${matchToStart.match_index + 1})` : ""}
                        </Button>
                      )}

                      {courtState?.phase === "in_progress" && currentMatch && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="mb-2 block text-sm text-muted-foreground">Team 1 Score</label>
                              <Input
                                type="number"
                                min="0"
                                value={team1Score}
                                onChange={(e) => setTeam1Score(e.target.value)}
                                className="h-12 text-center text-xl bg-secondary"
                              />
                            </div>
                            <div>
                              <label className="mb-2 block text-sm text-muted-foreground">Team 2 Score</label>
                              <Input
                                type="number"
                                min="0"
                                value={team2Score}
                                onChange={(e) => setTeam2Score(e.target.value)}
                                className="h-12 text-center text-xl bg-secondary"
                              />
                            </div>
                          </div>
                          <Button
                            onClick={() => {
                              endMatch.mutate({
                                team1Score: parseInt(team1Score) || 0,
                                team2Score: parseInt(team2Score) || 0,
                              });
                              setTeam1Score("");
                              setTeam2Score("");
                            }}
                            disabled={!team1Score || !team2Score}
                            className="w-full h-12 text-lg rounded-xl"
                          >
                            End Match
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Reset Section */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg text-destructive">Danger Zone</CardTitle>
                </CardHeader>
                <CardContent>
                  {!showResetDialog ? (
                    <Button
                      variant="outline"
                      onClick={() => setShowResetDialog(true)}
                      className="w-full border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    >
                      Reset Court
                    </Button>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Type "RESET COURT {courtNumber}" to confirm
                      </p>
                      <Input
                        placeholder={`RESET COURT ${courtNumber}`}
                        value={resetPhrase}
                        onChange={(e) => setResetPhrase(e.target.value)}
                        className="bg-secondary"
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setShowResetDialog(false);
                            setResetPhrase("");
                          }}
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={handleResetCourt}
                          className="flex-1"
                        >
                          Reset
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Court Roster Tab */}
            <TabsContent value="roster">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Full Court Roster</CardTitle>
                </CardHeader>
                <CardContent>
                  {matches.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground">Waiting for rotation to be generated...</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 z-10 bg-card">
                          <TableRow className="border-border">
                            <TableHead className="text-xs bg-card">#</TableHead>
                            <TableHead className="text-xs bg-card">Team 1</TableHead>
                            <TableHead className="text-xs bg-card">Team 2</TableHead>
                            <TableHead className="text-xs text-center bg-card">Score</TableHead>
                            <TableHead className="text-xs text-center bg-card">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {matches.map((match) => {
                            const isCurrent = match.match_index === courtState?.current_match_index;
                            const isCompleted = match.status === "completed";

                            return (
                              <TableRow
                                key={match.id}
                                className={`border-border ${
                                  isCurrent && courtState?.phase === "in_progress" ? "bg-primary/10" : isCompleted ? "opacity-60" : ""
                                }`}
                              >
                                <TableCell className={`font-medium ${isCurrent ? "text-primary" : ""}`}>
                                  {match.match_index + 1}
                                </TableCell>
                                <TableCell className="text-sm">
                                  <div>
                                    <p>{getPlayerName(match.team1_player1_id)}</p>
                                    <p>{getPlayerName(match.team1_player2_id)}</p>
                                  </div>
                                </TableCell>
                                <TableCell className="text-sm">
                                  <div>
                                    <p>{getPlayerName(match.team2_player1_id)}</p>
                                    <p>{getPlayerName(match.team2_player2_id)}</p>
                                  </div>
                                </TableCell>
                                <TableCell className="text-center">
                                  {isCompleted ? (
                                    <span className="font-semibold">
                                      {match.team1_score} - {match.team2_score}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-center">
                                  {getStatusBadge(match.status || "pending")}
                                </TableCell>
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
    </PageLayout>
  );
};

export default AdminCourt;

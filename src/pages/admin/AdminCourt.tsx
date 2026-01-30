import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { ChevronLeft, Plus, Trash2, Edit2, Check, X } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";

const AdminCourt = () => {
  const { courtId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const courtNumber = parseInt(courtId || "1");

  const [newPlayerName, setNewPlayerName] = useState("");
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetPassword, setResetPassword] = useState("");

  useEffect(() => {
    const isAdmin = localStorage.getItem("gp_admin_unlocked") === "true";
    if (!isAdmin) {
      navigate("/admin/login");
    }
  }, [navigate]);

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
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-rotation", {
        body: { courtId: courtNumber },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["matches", courtNumber] });
      queryClient.invalidateQueries({ queryKey: ["court_state", courtNumber] });
      toast.success("Rotation generated!");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to generate rotation");
    },
  });

  // Start match mutation
  const startMatch = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("court_state")
        .update({ phase: "in_progress", updated_at: new Date().toISOString() })
        .eq("court_id", courtNumber);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["court_state", courtNumber] });
      toast.success("Match started");
    },
  });

  // End match mutation
  const endMatch = useMutation({
    mutationFn: async ({ team1Score, team2Score }: { team1Score: number; team2Score: number }) => {
      const currentMatch = matches.find(m => m.match_index === courtState?.current_match_index);
      if (!currentMatch) throw new Error("No current match found");

      // Update match scores
      const { error: matchError } = await supabase
        .from("matches")
        .update({ team1_score: team1Score, team2_score: team2Score })
        .eq("id", currentMatch.id);
      if (matchError) throw matchError;

      // Advance to next match or complete
      const nextIndex = (courtState?.current_match_index || 0) + 1;
      const isCompleted = nextIndex >= matches.length;

      const { error: stateError } = await supabase
        .from("court_state")
        .update({
          current_match_index: isCompleted ? courtState?.current_match_index : nextIndex,
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
      // Delete matches first
      await supabase.from("matches").delete().eq("court_id", courtNumber);
      // Delete players
      await supabase.from("players").delete().eq("court_id", courtNumber);
      // Reset court state
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
      setResetPassword("");
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
    if (resetPhrase.toUpperCase() === expectedPhrase && resetPassword.toUpperCase() === "GPSC010226") {
      resetCourt.mutate();
    } else {
      toast.error("Invalid phrase or password");
    }
  };

  const currentMatch = matches.find(m => m.match_index === courtState?.current_match_index);
  const hasRotation = matches.length > 0;
  const canGenerateRotation = players.length >= 8 && players.length <= 12 && !hasRotation;

  const [team1Score, setTeam1Score] = useState("");
  const [team2Score, setTeam2Score] = useState("");

  const getPlayerName = (playerId: string | null) => {
    if (!playerId) return "—";
    const player = players.find(p => p.id === playerId);
    return player?.name || "—";
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

          {/* Players Section */}
          <Card className="mb-6 bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">
                Players {players.length > 0 && <span className="ml-2 text-sm font-normal text-primary">({players.length})</span>}
              </CardTitle>
              {players.length > 0 && hasRotation && (
                <p className="text-xs text-muted-foreground">
                  Renaming updates displays; history unchanged.
                </p>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Player list */}
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

              {/* Add player form */}
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
          </Card>

          {/* Rotation & Match Control */}
          <Card className="mb-6 bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg">Match Control</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!hasRotation ? (
                <Button
                  onClick={() => generateRotation.mutate()}
                  disabled={!canGenerateRotation || generateRotation.isPending}
                  className="w-full h-12 text-lg rounded-xl"
                >
                  {generateRotation.isPending ? "Generating..." : "Generate Rotation"}
                </Button>
              ) : (
                <>
                  {/* Current match info */}
                  <div className="rounded-xl bg-secondary p-4">
                    <div className="mb-2 text-sm text-muted-foreground">
                      Match {(courtState?.current_match_index || 0) + 1} of {matches.length}
                    </div>
                    {currentMatch && courtState?.phase !== "completed" ? (
                      <div className="text-lg font-semibold">
                        {getPlayerName(currentMatch.team1_player1_id)} & {getPlayerName(currentMatch.team1_player2_id)}
                        <span className="mx-2 text-muted-foreground">vs</span>
                        {getPlayerName(currentMatch.team2_player1_id)} & {getPlayerName(currentMatch.team2_player2_id)}
                      </div>
                    ) : (
                      <div className="text-lg font-semibold text-primary">Court Completed</div>
                    )}
                    <div className="mt-2 text-sm text-primary capitalize">
                      {courtState?.phase || "idle"}
                    </div>
                  </div>

                  {/* Match controls */}
                  {courtState?.phase === "idle" && currentMatch && (
                    <Button
                      onClick={() => startMatch.mutate()}
                      className="w-full h-12 text-lg rounded-xl"
                    >
                      Start Match
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
                    Type "RESET COURT {courtNumber}" and enter password to confirm
                  </p>
                  <Input
                    placeholder={`RESET COURT ${courtNumber}`}
                    value={resetPhrase}
                    onChange={(e) => setResetPhrase(e.target.value)}
                    className="bg-secondary"
                  />
                  <Input
                    type="password"
                    placeholder="Password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    className="bg-secondary"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setShowResetDialog(false);
                        setResetPhrase("");
                        setResetPassword("");
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
        </div>
      </div>
    </PageLayout>
  );
};

export default AdminCourt;

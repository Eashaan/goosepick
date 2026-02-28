import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft } from "lucide-react";

interface Player {
  id: string;
  name: string;
  court_id: number;
  is_guest?: boolean;
  added_by_admin?: boolean;
}

type PlayerSlot = "team1_player1_id" | "team1_player2_id" | "team2_player1_id" | "team2_player2_id";

interface MatchPlayer {
  id: string;
  name: string;
  slot: PlayerSlot;
}

interface PlayerSwapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courtId: number;
  matchId: string;
  allPlayers: Player[];
  matchPlayerIds: (string | null)[];
  groupId?: string;
  sessionId?: string;
  // Legacy single-player mode (used by AdminCourt)
  playerSlot?: PlayerSlot;
  currentPlayerId?: string;
  currentPlayerName?: string;
  // New multi-player mode (used by AdminGroup)
  matchPlayers?: MatchPlayer[];
}

const PlayerSwapModal = ({
  open,
  onOpenChange,
  courtId,
  matchId,
  allPlayers,
  matchPlayerIds,
  groupId,
  sessionId,
  // Legacy props
  playerSlot,
  currentPlayerId,
  currentPlayerName,
  // New props
  matchPlayers,
}: PlayerSwapModalProps) => {
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState<"existing" | "guest">("existing");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [guestName, setGuestName] = useState("");
  // For multi-player mode: which player is selected for replacement
  const [selectedMatchPlayer, setSelectedMatchPlayer] = useState<MatchPlayer | null>(null);

  const isMultiMode = !!matchPlayers && matchPlayers.length > 0;

  // Determine current target player (from selection step or legacy props)
  const activeSlot = selectedMatchPlayer?.slot ?? playerSlot;
  const activePlayerId = selectedMatchPlayer?.id ?? currentPlayerId;
  const activePlayerName = selectedMatchPlayer?.name ?? currentPlayerName;

  // Filter out players already in this match
  const availablePlayers = allPlayers.filter(
    (p) => !matchPlayerIds.includes(p.id) || p.id === activePlayerId
  );

  // Create guest player mutation
  const createGuestPlayer = useMutation({
    mutationFn: async (name: string): Promise<Player> => {
      const trimmedName = name.trim();
      const existing = allPlayers.find(
        (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
      );
      if (existing) return existing;

      const insertData: any = {
        name: trimmedName,
        is_guest: true,
        added_by_admin: true,
      };
      if (sessionId) {
        insertData.session_id = sessionId;
      }
      if (groupId) {
        insertData.group_id = groupId;
      } else {
        insertData.court_id = courtId;
      }

      const { data, error } = await supabase
        .from("players")
        .insert(insertData)
        .select()
        .single();

      if (error) throw error;
      return data as Player;
    },
  });

  // Swap player mutation
  const swapPlayer = useMutation({
    mutationFn: async (substitutePlayerId: string) => {
      const otherPlayerIds = matchPlayerIds.filter((id) => id !== activePlayerId);
      if (otherPlayerIds.includes(substitutePlayerId)) {
        throw new Error("Player already in this match");
      }

      const { error: matchError } = await supabase
        .from("matches")
        .update({ [activeSlot!]: substitutePlayerId })
        .eq("id", matchId);

      if (matchError) throw matchError;

      const auditData: any = {
        match_id: matchId,
        replaced_player_id: activePlayerId,
        substitute_player_id: substitutePlayerId,
      };
      if (groupId) {
        auditData.group_id = groupId;
        auditData.court_id = 0;
      } else {
        auditData.court_id = courtId;
      }

      const { error: auditError } = await supabase
        .from("match_substitutions")
        .insert(auditData);

      if (auditError) {
        console.error("Audit insert failed:", auditError);
      }
    },
    onSuccess: () => {
      if (groupId) {
        queryClient.invalidateQueries({ queryKey: ["group_matches", groupId] });
        queryClient.invalidateQueries({ queryKey: ["group_players", groupId] });
      } else {
        queryClient.invalidateQueries({ queryKey: ["matches", courtId] });
        queryClient.invalidateQueries({ queryKey: ["players", courtId] });
      }
      toast.success("Player swapped successfully");
      handleClose();
    },
    onError: (error: Error) => {
      if (error.message.includes("already in this match")) {
        toast.error("Player already in this match");
      } else {
        toast.error("Failed to swap player");
        console.error("Swap error:", error);
      }
    },
  });

  const handleClose = () => {
    setSelectedPlayerId("");
    setGuestName("");
    setSelectedTab("existing");
    setSelectedMatchPlayer(null);
    onOpenChange(false);
  };

  const handleBack = () => {
    setSelectedPlayerId("");
    setGuestName("");
    setSelectedTab("existing");
    setSelectedMatchPlayer(null);
  };

  const handleConfirmSwap = async () => {
    try {
      let substituteId: string;

      if (selectedTab === "existing") {
        if (!selectedPlayerId) {
          toast.error("Please select a replacement player");
          return;
        }
        substituteId = selectedPlayerId;
      } else {
        const trimmedName = guestName.trim();
        if (!trimmedName) {
          toast.error("Please enter a valid name");
          return;
        }

        const existing = allPlayers.find(
          (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
        );
        if (existing?.id === activePlayerId) {
          toast.error("Cannot swap with the same player");
          return;
        }
        if (existing && matchPlayerIds.includes(existing.id) && existing.id !== activePlayerId) {
          toast.error("Player already in this match");
          return;
        }

        const guestPlayer = await createGuestPlayer.mutateAsync(trimmedName);
        substituteId = guestPlayer.id;
        queryClient.invalidateQueries({ queryKey: ["players", courtId] });
      }

      await swapPlayer.mutateAsync(substituteId);
    } catch (error) {
      // Error handled in mutation onError
    }
  };

  const isLoading = createGuestPlayer.isPending || swapPlayer.isPending;

  // Determine if we should show player selection step
  const showPlayerSelection = isMultiMode && !selectedMatchPlayer;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {showPlayerSelection ? "Edit Lineup" : "Replace Player"}
          </DialogTitle>
        </DialogHeader>

        {showPlayerSelection ? (
          /* Step 1: Select which player to replace */
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Which player do you want to replace?
            </p>
            <div className="grid grid-cols-1 gap-2">
              {matchPlayers!.map((mp) => (
                <button
                  key={mp.slot}
                  className="flex items-center gap-3 rounded-lg border border-border bg-secondary p-3 text-left transition-colors hover:bg-accent hover:border-primary"
                  onClick={() => setSelectedMatchPlayer(mp)}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {mp.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium">{mp.name}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Step 2: Replacement flow */
          <div className="space-y-4">
            {isMultiMode && (
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={handleBack}
              >
                <ChevronLeft className="h-3 w-3" />
                Back to player selection
              </button>
            )}

            <div className="rounded-lg bg-secondary p-3">
              <p className="text-sm text-muted-foreground">Replacing:</p>
              <p className="font-semibold text-primary">{activePlayerName}</p>
            </div>

            <Tabs value={selectedTab} onValueChange={(v) => setSelectedTab(v as "existing" | "guest")}>
              <TabsList className="w-full">
                <TabsTrigger value="existing" className="flex-1">
                  Select Replacement
                </TabsTrigger>
                <TabsTrigger value="guest" className="flex-1">
                  Add Guest
                </TabsTrigger>
              </TabsList>

              <TabsContent value="existing" className="space-y-3 pt-4">
                <Label>Select replacement player</Label>
                <Select value={selectedPlayerId} onValueChange={setSelectedPlayerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a player..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePlayers
                      .filter((p) => p.id !== activePlayerId)
                      .map((player) => (
                        <SelectItem key={player.id} value={player.id}>
                          {player.name}
                          {player.is_guest && (
                            <span className="ml-2 text-xs text-muted-foreground">(Guest)</span>
                          )}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {availablePlayers.filter((p) => p.id !== activePlayerId).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No available players. Use the "Add Guest" tab to add a new player.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="guest" className="space-y-3 pt-4">
                <Label>Guest player name</Label>
                <Input
                  placeholder="Type name..."
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  If this name already exists, the existing player will be used.
                </p>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {!showPlayerSelection && (
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button onClick={handleConfirmSwap} disabled={isLoading}>
              {isLoading ? "Swapping..." : "Confirm Swap"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PlayerSwapModal;

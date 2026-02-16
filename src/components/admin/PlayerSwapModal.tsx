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

interface Player {
  id: string;
  name: string;
  court_id: number;
  is_guest?: boolean;
  added_by_admin?: boolean;
}

interface PlayerSwapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courtId: number;
  matchId: string;
  playerSlot: "team1_player1_id" | "team1_player2_id" | "team2_player1_id" | "team2_player2_id";
  currentPlayerId: string;
  currentPlayerName: string;
  allPlayers: Player[];
  matchPlayerIds: (string | null)[];
  groupId?: string;
}

const PlayerSwapModal = ({
  open,
  onOpenChange,
  courtId,
  matchId,
  playerSlot,
  currentPlayerId,
  currentPlayerName,
  allPlayers,
  matchPlayerIds,
  groupId,
}: PlayerSwapModalProps) => {
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState<"existing" | "guest">("existing");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [guestName, setGuestName] = useState("");

  // Filter out players already in this match
  const availablePlayers = allPlayers.filter(
    (p) => !matchPlayerIds.includes(p.id) || p.id === currentPlayerId
  );

  // Create guest player mutation
  const createGuestPlayer = useMutation({
    mutationFn: async (name: string): Promise<Player> => {
      const trimmedName = name.trim();
      
      // Check if player with this name already exists (case-insensitive)
      const existing = allPlayers.find(
        (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
      );
      
      if (existing) {
        return existing;
      }

      // Create new guest player
      const insertData: any = {
        name: trimmedName,
        is_guest: true,
        added_by_admin: true,
      };
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
      // Validate substitute is not already in the match (excluding the slot being replaced)
      const otherPlayerIds = matchPlayerIds.filter((id) => id !== currentPlayerId);
      if (otherPlayerIds.includes(substitutePlayerId)) {
        throw new Error("Player already in this match");
      }

      // Update the match with the new player
      const { error: matchError } = await supabase
        .from("matches")
        .update({ [playerSlot]: substitutePlayerId })
        .eq("id", matchId);

      if (matchError) throw matchError;

      // Insert audit record
      const auditData: any = {
        match_id: matchId,
        replaced_player_id: currentPlayerId,
        substitute_player_id: substitutePlayerId,
      };
      if (groupId) {
        auditData.group_id = groupId;
        auditData.court_id = 0; // placeholder for non-null constraint
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
    onOpenChange(false);
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
        // Guest tab
        const trimmedName = guestName.trim();
        if (!trimmedName) {
          toast.error("Please enter a valid name");
          return;
        }

        // Check if this would be the same player
        const existing = allPlayers.find(
          (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
        );
        if (existing?.id === currentPlayerId) {
          toast.error("Cannot swap with the same player");
          return;
        }

        // Check if existing player is already in match
        if (existing && matchPlayerIds.includes(existing.id) && existing.id !== currentPlayerId) {
          toast.error("Player already in this match");
          return;
        }

        const guestPlayer = await createGuestPlayer.mutateAsync(trimmedName);
        substituteId = guestPlayer.id;
        
        // Refresh players list to include new guest
        queryClient.invalidateQueries({ queryKey: ["players", courtId] });
      }

      // Perform the swap
      await swapPlayer.mutateAsync(substituteId);
    } catch (error) {
      // Error handled in mutation onError
    }
  };

  const isLoading = createGuestPlayer.isPending || swapPlayer.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Replace Player</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg bg-secondary p-3">
            <p className="text-sm text-muted-foreground">Replacing:</p>
            <p className="font-semibold text-primary">{currentPlayerName}</p>
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
                    .filter((p) => p.id !== currentPlayerId)
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
              {availablePlayers.filter((p) => p.id !== currentPlayerId).length === 0 && (
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

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirmSwap} disabled={isLoading}>
            {isLoading ? "Swapping..." : "Confirm Swap"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PlayerSwapModal;

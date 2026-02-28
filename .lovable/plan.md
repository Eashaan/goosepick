

## Problem

The "Edit Lineup" button hardcodes `team1_player1_id` as the only replaceable player (line 671-674). The `PlayerSwapModal` only supports replacing one pre-selected player at a time.

## Fix

### 1. Redesign `PlayerSwapModal` to allow selecting which player to replace

Instead of receiving a single `currentPlayerId`/`currentPlayerName`/`playerSlot`, the modal should:
- Accept all 4 match players (IDs + names + slots)
- Show a **player selection step first** — "Which player do you want to replace?" with 4 tappable player cards
- After selecting a player, proceed to the existing replacement flow (existing player or guest tabs)
- Add a "Back" option to re-pick a different player

### 2. Update `AdminGroup.tsx` — Pass all match players to the modal

- Change `swapTarget` state to only store `matchId` (no longer a single player)
- Pass the full match object's 4 player slots to the modal
- The "Edit Lineup" button click just opens the modal with the matchId

### 3. Files changed

- **`src/components/admin/PlayerSwapModal.tsx`** — Add player selection step before replacement flow; new props for all 4 players
- **`src/pages/admin/AdminGroup.tsx`** — Simplify swapTarget state, pass match data to modal


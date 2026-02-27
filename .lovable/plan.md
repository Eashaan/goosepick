

## Problem Analysis

The personal roadmap in group mode has a fundamental index mismatch. Here's the data model:

```text
Group with N=2 courts:
global_match_index:  1  2  3  4  5  6 ...
match_index (round): 0  0  1  1  2  2 ...
court:               C1 C2 C1 C2 C1 C2 ...
```

`match_index` = round number (0-based). N matches share each round.

**Bug 1 — Index mismatch**: `syntheticCourtState.current_match_index` is set to `current_match_global_index` (e.g., 3), but `SlotMachineRoadmap` compares it against `match.match_index` (round number, e.g., 1). These are different scales, so active/past detection breaks.

**Bug 2 — Nudge miss**: `PersonalRoster` uses `matches.find(m => m.match_index === currentMatchIndex)` — finds only ONE match in the round. If the player is on a different court in that round, the "You're live" nudge never fires.

**Bug 3 — Proximity count**: The "up next" nudge counts individual uncompleted matches before the player's next match. With N=2, one uncompleted round = 2 uncompleted matches, giving wrong proximity messaging.

**Bug 4 — Labeling**: Roadmap says "Match X" and sitout says "after X matches" — for groups these should reference rounds, since N matches happen per round.

---

## Changes

### 1. `src/pages/public/PublicGroup.tsx` — Fix synthetic courtState

Convert `current_match_global_index` to a 0-based round number:
```typescript
const N = group?.court_ids?.length || 1;
const currentRound = currentGlobalIndex > 0
  ? Math.floor((currentGlobalIndex - 1) / N)
  : 0;
// ...
current_match_index: currentRound,
```

### 2. `src/components/public/PersonalRoster.tsx` — Fix nudge logic for groups

Add an optional `courtsInGroup` prop (default 1).

- **"You're live" check**: Instead of `matches.find(...)`, use `matches.filter(m => m.match_index === currentRound)` and check if the player appears in ANY of those N matches.
- **Proximity count**: Count uncompleted **rounds** before the player's next round, not individual matches. Group uncompleted matches by `match_index`, count distinct rounds.

### 3. `src/components/public/SlotMachineRoadmap.tsx` — Group-aware labeling

Add an optional `isGroupMode` prop.

- When `isGroupMode`, display "Round X" instead of "Match X"
- Sitout text: "after X round(s)" instead of "after X match(es)"

### 4. `src/pages/public/PublicGroup.tsx` — Pass new props

Pass `courtsInGroup={group.court_ids.length}` to `PersonalRoster`, which forwards `isGroupMode` to `SlotMachineRoadmap`.


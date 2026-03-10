

# Goosepick Social — Implementation Plan

## Overview
A premium, live-event-ready web app for managing pickleball social mini-leagues across multiple courts. Designed for minimal admin effort and maximum participant engagement.

---

## Phase 1: Foundation & Design System

### Design System Setup
- Configure the strict color palette: Black (#000000), White (#FFFFFF), Goosepick Orange (#FF4200)
- Implement Apple-like typography, large buttons, rounded corners, subtle shadows
- Mobile-first responsive breakpoints
- Add the Goosepick logo to the project assets

### Global Footer
- "Goosepick Social - February 1, 2026" displayed subtly on every page
- Consistent premium styling throughout

---

## Phase 2: Database & Backend Setup

### Supabase Configuration
- **courts** — 7 pre-seeded courts
- **players** — (id, court_id, name, created_at)
- **matches** — Team compositions and scores
- **court_state** — Current match index, phase (idle/in_progress/completed)
- **feedback** — Post-match ratings and notes

### Row-Level Security
- Public read access for viewing rosters/leaderboards
- Admin write access for player management and scoring
- Secure feedback submission

### Supabase Realtime
- Enable real-time subscriptions on court_state and matches tables
- Instant updates for Court Pulse, roadmap state, and leaderboard

---

## Phase 3: Home Page

### Landing Experience
- Full black background
- Centered Goosepick logo (white version)
- **Primary CTA**: Orange button → "Goosepick Social Roster" → `/public`
- **Secondary CTA**: Underlined text → "Admin Login" → `/admin/login`

---

## Phase 4: Admin Flow

### Admin Login (`/admin/login`)
- Password entry: GPS0126 (case-insensitive)
- Store admin status in localStorage

### Admin Dashboard (`/admin`)
- Court selector (Courts 1–7)
- Navigate to individual court management

### Court Management (`/admin/court/:courtId`)

**Section A — Player Management**
- Add 8–12 unique player names
- Inline name editing with validation
- "Players: N" badge after saving
- **Reset Players**: Requires typed phrase "RESET COURT X" + password GPSC010226
- Cascading delete (matches first, then players)

**Section B — Rotation & Live Match Control**
- "Generate Rotation" button (calls Edge Function)
- **Live Match Controls**:
  - Start Match → sets phase to in_progress
  - End Match → save scores, advance index, update phase
  - Match dropdown for manual override (with confirmation)

---

## Phase 5: Rotation Edge Function

### Server-Side Algorithm
- Accepts 8–12 players, generates 17 doubles matches
- **Constraints**:
  1. No repeat partners
  2. Maximum 2 consecutive sit-outs
  3. Balanced match count per player
  4. Minimize repeat opponents
- Returns match array with player IDs
- Stores rotation in matches table

---

## Phase 6: Public Flow

### Court Selector (`/public`)
- Premium court selection grid
- Navigate to individual court views

### Court View (`/public/court/:courtId`)

**Court Pulse (Always Visible)**
- Real-time status driven by court_state
- **In Progress**: "Now Playing" with orange-highlighted teams
- **Idle**: "Up Next" with upcoming teams
- **Completed**: "Court Completed"
- Match counter: "Match X of 17"

**Sticky Tab Navigation**
1. Personal Roster (Default)
2. Court Roster
3. Leaderboard

---

## Phase 7: Personal Roster Experience

### User Identification
- Dropdown to select your name from players list
- Saved in localStorage by player_id
- "Change" option to switch identity

### "You're Up Next" Micro-Nudges
- **2 matches away**: "You've got time. Stretch or watch the match."
- **1 match away**: "You're up next. Grab water & be courtside."
- **Currently playing**: "You're live on Court X."
- **Finished**: "You're done for today. Nice work 👏"

### Slot Machine Roadmap (Non-Scrollable)

**Core Experience**
- Fixed viewport window — NO user scrolling
- Displays match bubbles and sit-out dots
- State changes trigger smooth vertical slide animations (350–550ms, ease-in-out)

**Display Rules**
- Current match: Centered orange bubble
- Single sit-out: Bubble + one dot on connector
- Double sit-out: Two dots visible with upcoming bubble edge hint
- Past matches: Grey styling
- Future matches: Muted styling
- Active element: Orange highlight (#FF4200)

**Dot Messaging**
- "Your next tie is after 1 match" / "...after 2 matches"

---

## Phase 8: Personal Stats & Downloads

### Live Personal Stats (Collapsible)
- Title: "Your Goosepick Social – February 1, 2026"
- **Stats Displayed**:
  - Matches Played
  - Wins
  - Win %
  - Avg Point Diff / Match
  - Performance Index (PI = Win% × 100 + Avg Point Diff / Match)
  - Most Common Partner

### Stats Card Preview & Download
**Trigger**: When player completes ALL their matches

- Microcopy: "You're done for today 👏"
- Button: "Preview & Download Your Personal Stats Card"
- **Modal**: Full-screen preview of branded stats card
- **Export**: PNG image optimized for Instagram/WhatsApp

### Post-Download Pop-up
- "Share your day on Instagram and tag us @goosepickleball"
- CTA: "Got it"

---

## Phase 9: Post-Match Feedback

### Feedback Pop-up (Not a Page Section)
**Trigger**: Immediately when player completes their FINAL match

**Modal Design**:
- Title: "Quick feedback?"
- Microcopy: "Your feedback helps us make your next Goosepick Social even better."
- **Single-tap options**: 😍 Loved it / 🙂 Good / 😐 Okay
- Optional note field (120 chars max)
- Primary: "Submit" / Secondary: "Skip" (subtle)
- Tiny corner X to close

**Data Storage**:
- Save to feedback table (court_id, player_id, rating, note)
- Show only once per player per court (flag in database)

---

## Phase 10: Court Roster Tab

### Full Schedule View
- All 17 matches listed in order
- **Columns**: Team 1 | Team 2 | Team 1 Score | Team 2 Score
- Real-time score updates via Supabase Realtime
- Visual indication of current/completed matches

---

## Phase 11: Leaderboard Tab

### Performance Index Table
**Columns (Exact Order)**:
1. Player Name (sticky column)
2. Matches
3. Wins
4. Win %
5. Avg Point Diff / Match
6. Performance Index

**Features**:
- Sticky header row
- Sorted by PI descending
- Includes players with 0 matches
- Real-time updates

---

## Technical Architecture Summary

| Component | Technology |
|-----------|------------|
| Frontend | React + TypeScript + Tailwind |
| Backend | Supabase (Lovable Cloud) |
| Real-time | Supabase Realtime Subscriptions |
| Rotation Algorithm | Supabase Edge Function |
| Image Export | Canvas API → PNG |
| State Management | React Query + localStorage |
| Animations | CSS transitions + Framer Motion |

---

## Parallel Usage Considerations
- All database operations scoped by court_id
- Single-row updates for scoring
- Optimistic UI with server reconciliation
- Last-write-wins acceptable for this event format


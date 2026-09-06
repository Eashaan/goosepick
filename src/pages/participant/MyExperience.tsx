import { useEffect, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import { format } from "date-fns";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CourtPulse from "@/components/public/CourtPulse";
import GroupCourtPulse from "@/components/public/GroupCourtPulse";
import PersonalRoster from "@/components/public/PersonalRoster";
import Leaderboard from "@/components/public/Leaderboard";
import RegistrationStateBadge from "@/components/participant/RegistrationStateBadge";
import { supabase } from "@/integrations/supabase/client";
import {
  participantDb,
  deriveRegistrationState,
  formatSessionDate,
  formatSessionPlace,
  formatSessionTitle,
  REGISTRATION_WITH_SESSION_SELECT,
  type DerivedRegistrationState,
  type ExperienceRegistrationRow,
} from "@/integrations/supabase/participantDb";
import { useParticipantAuth } from "@/hooks/useParticipantAuth";
import { useCourtRosterData, useGroupRosterData } from "@/hooks/useUnitRosterData";
import { buildSyntheticGroupCourtState, formatCourtNumbersLabel } from "@/lib/groupRoster";

interface StatusCopy {
  title: string;
  body?: string;
  cta?: { label: string; to: string };
}

/** What a participant sees when their seat has no roster player yet. */
export function statusCopyFor(state: DerivedRegistrationState, ownSeat: boolean): StatusCopy {
  switch (state) {
    case "roster_pending":
    case "roster_ready":
      return {
        title: "Your spot is confirmed. Roster coming soon.",
        body: "Your matches will appear here the moment the host builds the roster — no need to pick a court or your name.",
      };
    case "live":
      return {
        title: "This session is live.",
        body: "You're not on a roster yet. Please check in with the host at the venue.",
      };
    case "completed":
      return {
        title: "This session has ended.",
        body: "No roster was linked to this booking.",
      };
    case "profile_required":
      return ownSeat
        ? {
            title: "Complete your details",
            body: "Add your name and phone number so the host can place you on the roster.",
            cta: { label: "Complete details", to: "/my/profile" },
          }
        : {
            title: "This seat is reserved.",
            body: "Roster details will appear here once the participant's details are added.",
          };
    case "cancelled":
      return { title: "This booking was cancelled." };
    case "refunded":
      return { title: "This booking was refunded." };
    case "unmapped":
    default:
      return {
        title: "We're confirming your session.",
        body: "This booking is being matched to its Goosepick session. Check back soon.",
      };
  }
}

const MyExperience = () => {
  const { registrationId } = useParams();
  const queryClient = useQueryClient();
  const { profile } = useParticipantAuth();

  // 1. The registration itself — RLS only returns seats the signed-in user owns
  //    or purchased, so an unknown/foreign id simply resolves to null.
  const registrationQuery = useQuery({
    queryKey: ["my-registration", registrationId],
    enabled: Boolean(registrationId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await participantDb
        .from("experience_registrations")
        .select(REGISTRATION_WITH_SESSION_SELECT)
        .eq("id", registrationId!)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as ExperienceRegistrationRow | null) ?? null;
    },
  });

  // 2. The roster player linked to this seat (players.registration_id).
  const playerQuery = useQuery({
    queryKey: ["my-registration-player", registrationId],
    enabled: Boolean(registrationId) && Boolean(registrationQuery.data),
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await participantDb
        .from("players")
        .select("*")
        .eq("registration_id", registrationId!)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
  });

  // The moment an admin links this seat, swap from the status card to the roster.
  useEffect(() => {
    if (!registrationId) return;
    const channel = supabase
      .channel(`registration-${registrationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `registration_id=eq.${registrationId}` },
        () => queryClient.invalidateQueries({ queryKey: ["my-registration-player", registrationId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [registrationId, queryClient]);

  const registration = registrationQuery.data ?? null;
  const player = playerQuery.data ?? null;
  const session = registration?.sessions ?? null;
  const sessionId = player?.session_id ?? registration?.session_id ?? null;

  const isGroup = Boolean(player?.group_id);
  const isCourt = !isGroup && player?.court_id != null;

  // Same reads + realtime the /public pages use, keyed by the known session.
  const court = useCourtRosterData({ courtId: player?.court_id ?? null, sessionId, enabled: isCourt });
  const group = useGroupRosterData({ groupId: player?.group_id ?? null, sessionId, enabled: isGroup });

  const groupCourtIds = useMemo(() => {
    if (!isGroup) return [];
    return (
      group.groupCourtNumbers ||
      (group.group?.court_ids ?? []).map((_: number, i: number) => i + 1)
    );
  }, [isGroup, group.groupCourtNumbers, group.group?.court_ids]);

  const syntheticCourtId = group.group?.court_ids?.[0] ?? 0;
  const syntheticCourtState = useMemo(
    () =>
      isGroup
        ? buildSyntheticGroupCourtState({
            courtStates: group.courtStates,
            matches: group.matches,
            groupId: player?.group_id,
            syntheticCourtId,
            sessionId: group.group?.session_id ?? sessionId,
            courtsInGroup: group.group?.court_ids?.length || 1,
          })
        : undefined,
    [isGroup, group.courtStates, group.matches, player?.group_id, syntheticCourtId, group.group?.session_id, group.group?.court_ids?.length, sessionId],
  );

  const archived = session?.status === "ended";
  const state = registration ? deriveRegistrationState(registration, Boolean(player)) : null;

  const footerText = useMemo(() => {
    if (!session) return "";
    const eventName = session.event_type === "thursdays" ? "Goosepick Thursdays" : "Goosepick Social";
    const parsed = new Date(`${session.date}T00:00:00`);
    const day = Number.isNaN(parsed.getTime()) ? session.date : format(parsed, "MMMM d, yyyy");
    const city = session.cities?.name || "Mumbai";
    const location = session.locations?.name;
    return location ? `${eventName} ${city} – ${day} – ${location}` : `${eventName} ${city} – ${day}`;
  }, [session]);

  // ── Loading ──
  if (registrationQuery.isLoading || (registration && playerQuery.isLoading)) {
    return (
      <PageLayout showFooter={false}>
        <GlobalHeader />
        <div className="flex min-h-[70vh] items-center justify-center">
          <p className="text-muted-foreground">Loading your experience...</p>
        </div>
      </PageLayout>
    );
  }

  // ── Not visible to this account (RLS) or does not exist ──
  if (!registration || !state) {
    return (
      <PageLayout>
        <GlobalHeader />
        <div className="mx-auto w-full max-w-md px-6 py-8">
          <BackToMy />
          <div className="mt-6 rounded-2xl border border-border bg-card p-6 text-center">
            <p className="text-base font-semibold text-foreground">
              We couldn't find this experience in your account.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              It may belong to a different sign-in, or the link may be out of date.
            </p>
            <Button asChild className="mt-5 h-12 w-full rounded-xl text-base font-semibold">
              <Link to="/my">Back to My Goosepick</Link>
            </Button>
          </div>
        </div>
      </PageLayout>
    );
  }

  const title = formatSessionTitle(session);
  const place = formatSessionPlace(session);

  // ── Seat without a roster player yet: status-aware card ──
  if (!player) {
    const copy = statusCopyFor(state, Boolean(profile?.id) && registration.profile_id === profile?.id);
    return (
      <PageLayout>
        <GlobalHeader />
        <div className="mx-auto w-full max-w-md px-6 py-8">
          <BackToMy />
          <div className="mt-6 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-foreground">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{formatSessionDate(session?.date)}</p>
                {place && <p className="text-sm text-muted-foreground">{place}</p>}
                <p className="mt-1 text-xs text-muted-foreground">Seat {registration.seat_index}</p>
              </div>
              <RegistrationStateBadge state={state} />
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-secondary p-6 text-center" data-testid="experience-status">
            <p className="text-base font-semibold text-foreground">{copy.title}</p>
            {copy.body && <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>}
            {copy.cta && (
              <Button asChild className="mt-5 h-12 w-full rounded-xl text-base font-semibold">
                <Link to={copy.cta.to}>{copy.cta.label}</Link>
              </Button>
            )}
          </div>
        </div>
      </PageLayout>
    );
  }

  // ── Linked player: the existing roster experience, identity pre-selected ──
  const unitLabel = isGroup
    ? formatCourtNumbersLabel(groupCourtIds, "Your group")
    : court.courtDetails?.name || `Court ${player.court_id}`;

  const players = isGroup ? group.players : court.players;
  const matches = isGroup ? group.matches : court.matches;

  return (
    <PageLayout showFooter={false}>
      <div className="min-h-screen flex flex-col">
        <GlobalHeader />

        <div className="px-4 py-3 flex items-center gap-3 border-b border-border">
          <Button asChild variant="ghost" size="icon" className="shrink-0">
            <Link to="/my" aria-label="Back to My Goosepick">
              <ChevronLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{unitLabel}</h1>
            <p className="truncate text-xs text-muted-foreground">
              {title} · {formatSessionDate(session?.date)}
            </p>
          </div>
          <RegistrationStateBadge state={state} />
        </div>

        {archived && (
          <div className="mx-4 mt-3 rounded-xl bg-secondary/60 p-3 text-center">
            <p className="text-xs text-muted-foreground">
              This session has ended. You're viewing your final roster and stats.
            </p>
          </div>
        )}

        {isGroup ? (
          <GroupCourtPulse
            courtStates={group.courtStates}
            matches={matches}
            players={players}
            totalMatches={group.group?.total_matches || matches.length}
            courtIds={groupCourtIds}
          />
        ) : (
          <CourtPulse
            courtState={court.courtState}
            matches={matches}
            players={players}
            totalMatches={matches.length || 17}
          />
        )}

        <Tabs defaultValue="personal" className="flex-1 flex flex-col">
          <TabsList className="sticky top-0 z-10 mx-4 bg-secondary rounded-xl h-12">
            <TabsTrigger value="personal" className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Personal Roster
            </TabsTrigger>
            <TabsTrigger value="leaderboard" className="flex-1 rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              Leaderboard
            </TabsTrigger>
          </TabsList>

          <TabsContent value="personal" className="flex-1 mt-0 p-4">
            {isGroup ? (
              <PersonalRoster
                courtId={syntheticCourtId}
                players={players}
                matches={matches}
                courtState={syntheticCourtState}
                courtsInGroup={group.group?.court_ids?.length || 1}
                groupId={player.group_id ?? undefined}
                courtIds={groupCourtIds}
                fixedPlayerId={player.id}
                archived={archived}
              />
            ) : (
              <PersonalRoster
                courtId={player.court_id!}
                players={players}
                matches={matches}
                courtState={court.courtState}
                fixedPlayerId={player.id}
                archived={archived}
              />
            )}
          </TabsContent>

          <TabsContent value="leaderboard" className="flex-1 mt-0 p-4">
            <Leaderboard matches={matches} players={players} />
          </TabsContent>
        </Tabs>

        <div className="py-4 text-center border-t border-border">
          <p className="text-xs text-muted-foreground">{footerText}</p>
        </div>
      </div>
    </PageLayout>
  );
};

const BackToMy = () => (
  <Link
    to="/my"
    className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
  >
    <ChevronLeft className="h-4 w-4" /> My Goosepick
  </Link>
);

export default MyExperience;

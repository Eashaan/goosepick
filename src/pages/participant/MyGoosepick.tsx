import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import { Button } from "@/components/ui/button";
import { useParticipantAuth } from "@/hooks/useParticipantAuth";
import {
  participantDb,
  deriveRegistrationState,
  REGISTRATION_STATE_LABEL,
  type ExperienceRegistrationRow,
  type DerivedRegistrationState,
} from "@/integrations/supabase/participantDb";

const EXPERIENCES_URL = "https://goosepick.com";

const stateTone: Record<DerivedRegistrationState, string> = {
  profile_required: "bg-secondary text-foreground",
  roster_pending: "bg-secondary text-muted-foreground",
  roster_ready: "bg-primary/15 text-primary",
  live: "bg-primary text-primary-foreground",
  completed: "bg-secondary text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
  refunded: "bg-muted text-muted-foreground",
  unmapped: "bg-secondary text-muted-foreground",
};

const formatDate = (value?: string | null) => {
  if (!value) return "Date to be confirmed";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

interface RegistrationWithState {
  registration: ExperienceRegistrationRow;
  state: DerivedRegistrationState;
}

const MyGoosepick = () => {
  const navigate = useNavigate();
  const { profile, signOut } = useParticipantAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["my-registrations", profile?.id],
    enabled: Boolean(profile?.id),
    queryFn: async (): Promise<RegistrationWithState[]> => {
      const { data: rows, error } = await participantDb
        .from("experience_registrations")
        .select(
          `id, session_id, profile_id, purchaser_profile_id, seat_index, participant_name, status, created_at,
           sessions:sessions ( id, date, status, event_type, session_label, cities ( name ), locations ( name ) )`,
        )
        .order("created_at", { ascending: false });

      if (error) {
        console.warn("Registration lookup unavailable:", error.message);
        return [];
      }

      const registrations = (rows ?? []) as ExperienceRegistrationRow[];
      const ids = registrations.map((r) => r.id);

      let rosterLinked = new Set<string>();
      if (ids.length > 0) {
        const { data: players, error: playerError } = await participantDb
          .from("players")
          .select("registration_id")
          .in("registration_id", ids);
        if (!playerError && players) {
          rosterLinked = new Set(
            (players as { registration_id: string | null }[])
              .map((p) => p.registration_id)
              .filter((v): v is string => Boolean(v)),
          );
        }
      }

      return registrations.map((registration) => ({
        registration,
        state: deriveRegistrationState(registration, rosterLinked.has(registration.id)),
      }));
    },
  });

  const { upcoming, past } = useMemo(() => {
    const all = data ?? [];
    return {
      upcoming: all.filter(
        (item) => !["completed", "cancelled", "refunded"].includes(item.state),
      ),
      past: all.filter((item) => ["completed", "cancelled", "refunded"].includes(item.state)),
    };
  }, [data]);

  const greetingName = profile?.first_name?.trim() || "there";

  const renderCard = ({ registration, state }: RegistrationWithState) => {
    const session = registration.sessions;
    const title =
      session?.session_label ||
      (session?.event_type === "thursdays" ? "Goosepick Thursdays" : "Goosepick Social");
    const place = [session?.locations?.name, session?.cities?.name].filter(Boolean).join(", ");
    const canOpen = state !== "unmapped";

    return (
      <button
        type="button"
        key={registration.id}
        disabled={!canOpen}
        onClick={() => canOpen && navigate(`/my/experience/${registration.id}`)}
        className={`w-full rounded-2xl border border-border bg-card p-5 text-left transition-colors ${
          canOpen ? "hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" : "cursor-default"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-foreground">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{formatDate(session?.date)}</p>
            {place && <p className="text-sm text-muted-foreground">{place}</p>}
            {canOpen && (
              <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-primary">
                Open experience →
              </p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${stateTone[state]}`}
          >
            {REGISTRATION_STATE_LABEL[state]}
          </span>
        </div>
      </button>
    );
  };

  return (
    <PageLayout>
      <GlobalHeader />
      <div className="mx-auto w-full max-w-md px-6 py-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Hi {greetingName}</p>
            <h1 className="text-3xl font-bold text-foreground">My Goosepick</h1>
          </div>
          <button
            onClick={() => navigate("/my/profile")}
            className="mt-1 text-sm font-medium text-primary underline underline-offset-4"
          >
            Edit details
          </button>
        </div>

        {isLoading ? (
          <p className="mt-10 text-muted-foreground">Loading your experiences...</p>
        ) : (
          <div className="mt-8 space-y-10">
            <section className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Upcoming
              </h2>
              {upcoming.length > 0 ? (
                <div className="space-y-3">{upcoming.map(renderCard)}</div>
              ) : (
                <div className="rounded-2xl border border-border bg-card p-6 text-center">
                  <p className="text-base font-semibold text-foreground">
                    No Goosepick experiences yet.
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Book a session and it will show up here automatically.
                  </p>
                  <Button
                    asChild
                    className="mt-5 h-12 w-full rounded-xl text-base font-semibold"
                  >
                    <a href={EXPERIENCES_URL} target="_blank" rel="noopener noreferrer">
                      Browse Experiences
                    </a>
                  </Button>
                </div>
              )}
            </section>

            {past.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Past
                </h2>
                <div className="space-y-3">{past.map(renderCard)}</div>
              </section>
            )}
          </div>
        )}

        <div className="mt-12 border-t border-border pt-6">
          <button
            onClick={async () => {
              await signOut();
              navigate("/auth", { replace: true });
            }}
            className="text-sm font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    </PageLayout>
  );
};

export default MyGoosepick;

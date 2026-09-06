import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import { Button } from "@/components/ui/button";
import RegistrationStateBadge from "@/components/participant/RegistrationStateBadge";
import { useParticipantAuth } from "@/hooks/useParticipantAuth";
import {
  participantDb,
  deriveRegistrationState,
  formatSessionDate,
  formatSessionPlace,
  formatSessionTitle,
  isRegistrationOpenable,
  REGISTRATION_WITH_SESSION_SELECT,
  type ExperienceRegistrationRow,
  type DerivedRegistrationState,
} from "@/integrations/supabase/participantDb";

const EXPERIENCES_URL = "https://goosepick.com";

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
        .select(REGISTRATION_WITH_SESSION_SELECT)
        .order("created_at", { ascending: false });

      if (error) {
        // Restricted read: show the empty state, never crash.
        console.warn("Registration lookup unavailable:", error.message);
        return [];
      }

      const registrations = (rows ?? []) as unknown as ExperienceRegistrationRow[];
      const ids = registrations.map((r) => r.id);

      let rosterLinked = new Set<string>();
      if (ids.length > 0) {
        const { data: players, error: playerError } = await participantDb
          .from("players")
          .select("registration_id")
          .in("registration_id", ids);
        if (!playerError && players) {
          rosterLinked = new Set(
            players
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
    const title = formatSessionTitle(session);
    const place = formatSessionPlace(session);
    const openable = isRegistrationOpenable(state);

    const body = (
      <>
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-lg font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{formatSessionDate(session?.date)}</p>
          {place && <p className="text-sm text-muted-foreground">{place}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <RegistrationStateBadge state={state} />
          {openable && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </>
    );

    if (!openable) {
      return (
        <div
          key={registration.id}
          className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card p-5 opacity-80"
        >
          {body}
        </div>
      );
    }

    return (
      <button
        key={registration.id}
        type="button"
        onClick={() => navigate(`/my/experience/${registration.id}`)}
        className="flex w-full items-start justify-between gap-3 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Open ${title}`}
      >
        {body}
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

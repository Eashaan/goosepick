import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { participantDb, type ParticipantProfile } from "@/integrations/supabase/participantDb";
import type { Session, User } from "@supabase/supabase-js";

interface ParticipantAuthValue {
  user: User | null;
  session: Session | null;
  profile: ParticipantProfile | null;
  isLoading: boolean;
  /** True only when a signed-in user has a profile with the minimum details. */
  isProfileComplete: boolean;
  sendMagicLink: (email: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const ParticipantAuthContext = createContext<ParticipantAuthValue | undefined>(undefined);

export const PARTICIPANT_REDIRECT_PATH = "/auth/callback";

function isComplete(profile: ParticipantProfile | null): boolean {
  if (!profile) return false;
  return Boolean(profile.first_name?.trim()) && Boolean(profile.phone?.trim());
}

export function ParticipantAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ParticipantProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await participantDb
      .from("participant_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      // A missing table (before the migration is applied) must not break the app.
      console.warn("Participant profile lookup failed:", error.message);
      setProfile(null);
      return;
    }
    setProfile((data as ParticipantProfile) ?? null);
  }, []);

  useEffect(() => {
    // Listener first, then the initial session read.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (newSession?.user) {
        // Deferred to avoid re-entrant Supabase client calls.
        setTimeout(() => {
          void loadProfile(newSession.user.id).finally(() => setIsLoading(false));
        }, 0);
      } else {
        setProfile(null);
        setIsLoading(false);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: current } }) => {
      setSession(current);
      setUser(current?.user ?? null);
      if (current?.user) {
        await loadProfile(current.user.id);
      }
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const sendMagicLink = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: `${window.location.origin}${PARTICIPANT_REDIRECT_PATH}`,
      },
    });
    return { error: error ? error.message : null };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user) return;
    await loadProfile(user.id);
  }, [user, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo<ParticipantAuthValue>(
    () => ({
      user,
      session,
      profile,
      isLoading,
      isProfileComplete: isComplete(profile),
      sendMagicLink,
      refreshProfile,
      signOut,
    }),
    [user, session, profile, isLoading, sendMagicLink, refreshProfile, signOut],
  );

  return (
    <ParticipantAuthContext.Provider value={value}>{children}</ParticipantAuthContext.Provider>
  );
}

export function useParticipantAuth(): ParticipantAuthValue {
  const context = useContext(ParticipantAuthContext);
  if (!context) {
    throw new Error("useParticipantAuth must be used within a ParticipantAuthProvider");
  }
  return context;
}

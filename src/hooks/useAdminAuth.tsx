import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { can as canRole, highestRole, type Permission, type StaffRole } from "@/lib/rbac";

interface AdminAuthState {
  user: User | null;
  session: Session | null;
  /** Staff role (owner/admin/host/viewer) or null. Independent of participant profile. */
  role: StaffRole | null;
  /** True for any staff role — grants read access to the /admin namespace. */
  isAdmin: boolean;
  isStaff: boolean;
  can: (permission: Permission) => boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  /** Sends a 6-digit staff sign-in code (same email as participant sign-in). */
  sendCode: (email: string) => Promise<{ error: string | null }>;
  /** Verifies the 6-digit code, then requires a staff role or signs back out. */
  verifyCode: (email: string, token: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}


export async function fetchStaffRole(userId: string): Promise<StaffRole | null> {
  try {
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) {
      console.error("Error checking staff role:", error);
      return null;
    }
    return highestRole((data || []).map((r: any) => String(r.role)));
  } catch (err) {
    console.error("Error in fetchStaffRole:", err);
    return null;
  }
}

export function useAdminAuth(): AdminAuthState {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<StaffRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        // setTimeout avoids Supabase client deadlock inside the auth callback
        setTimeout(async () => {
          setRole(await fetchStaffRole(newSession.user.id));
          setIsLoading(false);
        }, 0);
      } else {
        setRole(null);
        setIsLoading(false);
      }
    });

    supabase.auth.getSession().then(async ({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      if (currentSession?.user) setRole(await fetchStaffRole(currentSession.user.id));
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<{ error: string | null }> => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: error.message };
      if (data.user) {
        const r = await fetchStaffRole(data.user.id);
        if (!r) {
          await supabase.auth.signOut();
          return { error: "You do not have admin access. Please contact an administrator." };
        }
        setRole(r);
      }
      return { error: null };
    } catch {
      return { error: "An unexpected error occurred" };
    }
  }, []);

  const sendCode = useCallback(async (email: string): Promise<{ error: string | null }> => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/admin/login` },
    });
    return { error: error ? error.message : null };
  }, []);

  const verifyCode = useCallback(async (email: string, token: string): Promise<{ error: string | null }> => {
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: token.trim(),
      type: "email",
    });
    if (error) return { error: error.message };
    if (data.user) {
      const r = await fetchStaffRole(data.user.id);
      if (!r) {
        await supabase.auth.signOut();
        return { error: "You do not have admin access. Please contact an administrator." };
      }
      setRole(r);
    }
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setRole(null);
  }, []);

  const can = useCallback((p: Permission) => canRole(role, p), [role]);

  return { user, session, role, isAdmin: !!role, isStaff: !!role, can, isLoading, signIn, sendCode, verifyCode, signOut };
}


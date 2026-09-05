import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageLayout from "@/components/layout/PageLayout";
import { supabase } from "@/integrations/supabase/client";
import { useParticipantAuth } from "@/hooks/useParticipantAuth";
import { Button } from "@/components/ui/button";

/**
 * Completes a passwordless sign-in. Handles both the PKCE `?code=` flow and the
 * implicit `#access_token=` hash flow so any Supabase email template works.
 */
const AuthCallback = () => {
  const navigate = useNavigate();
  const { user, isLoading } = useParticipantAuth();
  const [failed, setFailed] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const complete = async () => {
      const url = new URL(window.location.href);
      const errorDescription =
        url.searchParams.get("error_description") ||
        new URLSearchParams(url.hash.replace(/^#/, "")).get("error_description");

      if (errorDescription) {
        if (!cancelled) {
          setFailed(errorDescription);
          setExchanging(false);
        }
        return;
      }

      const code = url.searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error && !cancelled) {
          setFailed(error.message);
          setExchanging(false);
          return;
        }
      }

      if (!cancelled) setExchanging(false);
    };

    void complete();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (exchanging || isLoading) return;
    if (user) {
      navigate("/my", { replace: true });
    } else if (!failed) {
      setFailed("That sign-in link is no longer valid. Please request a new one.");
    }
  }, [exchanging, isLoading, user, failed, navigate]);

  return (
    <PageLayout>
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-6 text-center">
        {failed ? (
          <div className="w-full max-w-sm space-y-6">
            <h1 className="text-2xl font-bold text-foreground">Sign-in link problem</h1>
            <p className="text-sm text-muted-foreground">{failed}</p>
            <Button
              className="w-full h-14 text-lg font-semibold rounded-xl"
              onClick={() => navigate("/auth", { replace: true })}
            >
              Get a new link
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">Signing you in...</p>
        )}
      </div>
    </PageLayout>
  );
};

export default AuthCallback;

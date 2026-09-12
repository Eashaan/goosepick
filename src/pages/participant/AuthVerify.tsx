import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageLayout from "@/components/layout/PageLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { parseVerifyParams } from "@/lib/authVerify";

/**
 * Goosepick-branded sign-in link target. The email links to this app's own
 * domain with a one-time `token_hash` + `type`, which is exchanged for a
 * session here, then handed to the normal callback/return-path flow.
 *
 * The older link style (`/auth/callback` with `code` or a token hash fragment)
 * keeps working untouched.
 */
const AuthVerify = () => {
  const navigate = useNavigate();
  const [failed, setFailed] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const parsed = parseVerifyParams(window.location.search);
    if (!parsed) {
      setFailed("That sign-in link is incomplete or no longer valid. Please request a new one.");
      return;
    }

    let cancelled = false;

    const verify = async () => {
      const { error } = await supabase.auth.verifyOtp({
        token_hash: parsed.tokenHash,
        type: parsed.type,
      });

      if (cancelled) return;

      if (error) {
        setFailed("That sign-in link has expired or was already used. Please request a new one.");
        return;
      }

      // Continue through the existing callback flow so the profile-completion
      // and deep-link return-path behaviour stays identical.
      navigate(`/auth/callback?next=${encodeURIComponent(parsed.next)}`, { replace: true });
    };

    void verify();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

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

export default AuthVerify;

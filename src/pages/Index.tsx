import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import PageLayout from "@/components/layout/PageLayout";
import { useParticipantAuth } from "@/hooks/useParticipantAuth";

/**
 * Root = My Goosepick portal entry. Signed-in participants go to /my, everyone
 * else to the participant sign-in. The public court/group routes are unchanged.
 */
export function rootDestination(isSignedIn: boolean): string {
  return isSignedIn ? "/my" : "/auth";
}

const Index = () => {
  const navigate = useNavigate();
  const { user, isLoading } = useParticipantAuth();

  useEffect(() => {
    if (isLoading) return;
    navigate(rootDestination(Boolean(user)), { replace: true });
  }, [isLoading, user, navigate]);

  return (
    <PageLayout>
      <div className="flex min-h-[80vh] items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </PageLayout>
  );
};

export default Index;

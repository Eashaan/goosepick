import { useEffect, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import PageLayout from "@/components/layout/PageLayout";
import { useParticipantAuth } from "@/hooks/useParticipantAuth";

interface RequireParticipantProps {
  children: ReactNode;
  /** When false, an incomplete profile is allowed (the profile page itself). */
  requireCompleteProfile?: boolean;
}

/**
 * Route guard for participant pages. Being authenticated never implies admin —
 * admin authorization stays entirely with useAdminAuth / user_roles.
 */
const RequireParticipant = ({
  children,
  requireCompleteProfile = true,
}: RequireParticipantProps) => {
  const { user, isLoading, isProfileComplete } = useParticipantAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    if (requireCompleteProfile && !isProfileComplete && location.pathname !== "/my/profile") {
      navigate("/my/profile", { replace: true });
    }
  }, [isLoading, user, isProfileComplete, requireCompleteProfile, location.pathname, navigate]);

  if (isLoading || !user) {
    return (
      <PageLayout>
        <div className="flex min-h-[80vh] items-center justify-center">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </PageLayout>
    );
  }

  return <>{children}</>;
};

export default RequireParticipant;

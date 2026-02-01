import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import { useAdminAuth } from "@/hooks/useAdminAuth";

const AdminDashboard = () => {
  const navigate = useNavigate();
  const { isAdmin, isLoading, signOut, user } = useAdminAuth();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      navigate("/admin/login");
    }
  }, [isLoading, isAdmin, navigate]);

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  if (isLoading) {
    return (
      <PageLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </PageLayout>
    );
  }

  if (!isAdmin) {
    return null;
  }

  const courts = [1, 2, 3, 4, 5, 6, 7];

  return (
    <PageLayout>
      <GlobalHeader />
      <div className="min-h-screen px-6 py-8">
        <div className="mx-auto max-w-2xl">
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
            <p className="mt-2 text-muted-foreground">Select a court to manage</p>
            {user?.email && (
              <p className="mt-1 text-xs text-muted-foreground">
                Signed in as {user.email}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {courts.map((courtId) => (
              <Button
                key={courtId}
                asChild
                variant="secondary"
                className="h-24 text-xl font-semibold rounded-2xl hover:bg-primary hover:text-primary-foreground transition-all duration-200"
              >
                <Link to={`/admin/court/${courtId}`}>
                  Court {courtId}
                </Link>
              </Button>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Button
              variant="ghost"
              onClick={handleLogout}
              className="text-muted-foreground hover:text-foreground"
            >
              Logout
            </Button>
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default AdminDashboard;

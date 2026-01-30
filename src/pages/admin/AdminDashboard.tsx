import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import PageLayout from "@/components/layout/PageLayout";

const AdminDashboard = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const isAdmin = localStorage.getItem("gp_admin_unlocked") === "true";
    if (!isAdmin) {
      navigate("/admin/login");
    }
  }, [navigate]);

  const courts = [1, 2, 3, 4, 5, 6, 7];

  return (
    <PageLayout>
      <div className="min-h-screen px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
            <p className="mt-2 text-muted-foreground">Select a court to manage</p>
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
              onClick={() => {
                localStorage.removeItem("gp_admin_unlocked");
                navigate("/");
              }}
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

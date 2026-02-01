import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";

const PublicCourtSelector = () => {
  const courts = [1, 2, 3, 4, 5, 6, 7];

  return (
    <PageLayout>
      <GlobalHeader />
      <div className="min-h-screen px-6 py-8">
        <div className="mx-auto max-w-2xl">

          <div className="mb-10 text-center">
            <h1 className="text-2xl font-bold text-foreground">Select Your Court</h1>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {courts.map((courtId) => (
              <Button
                key={courtId}
                asChild
                variant="secondary"
                className="h-24 text-xl font-semibold rounded-2xl hover:bg-primary hover:text-primary-foreground transition-all duration-200"
              >
                <Link to={`/public/court/${courtId}`}>
                  Court {courtId}
                </Link>
              </Button>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              to="/"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </PageLayout>
  );
};

export default PublicCourtSelector;

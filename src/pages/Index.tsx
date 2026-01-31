import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import PageLayout from "@/components/layout/PageLayout";
import goosepickLogo from "@/assets/goosepick-logo-white.png";

const Index = () => {
  return (
    <PageLayout>
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        {/* Logo - Fixed aspect ratio container */}
        <div className="mb-12 animate-fade-in w-full max-w-[280px] md:max-w-[400px] flex-shrink-0">
          <div className="relative w-full" style={{ aspectRatio: "3 / 1" }}>
            <img
              src={goosepickLogo}
              alt="Goosepick"
              className="absolute inset-0 w-full h-full object-contain"
            />
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-col items-center gap-6 animate-slide-up">
          {/* Primary CTA */}
          <Button
            asChild
            size="lg"
            className="min-w-[280px] h-14 text-lg font-semibold rounded-2xl bg-primary hover:bg-primary/90 shadow-glow hover:shadow-glow-lg transition-all duration-300"
          >
            <Link to="/public">Goosepick Social Roster</Link>
          </Button>

          {/* Secondary CTA */}
          <Link
            to="/admin/login"
            className="text-primary hover:text-primary/80 underline underline-offset-4 text-sm font-medium transition-colors"
          >
            Admin Login
          </Link>
        </div>
      </div>
    </PageLayout>
  );
};

export default Index;

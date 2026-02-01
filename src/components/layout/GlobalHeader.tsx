import goosepickSocialLogo from "@/assets/goosepick-social-logo.png";

interface GlobalHeaderProps {
  showBackButton?: boolean;
  backTo?: string;
  title?: string;
}

const GlobalHeader = ({ showBackButton, backTo, title }: GlobalHeaderProps) => {
  return (
    <header className="sticky top-0 z-50 bg-background border-b border-border">
      <div className="flex items-center justify-center py-3 px-4">
        <div className="h-12 w-12 flex-shrink-0">
          <img
            src={goosepickSocialLogo}
            alt="Goosepick Social"
            className="h-full w-full object-contain"
          />
        </div>
      </div>
    </header>
  );
};

export default GlobalHeader;

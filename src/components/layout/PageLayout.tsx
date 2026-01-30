import GlobalFooter from "./GlobalFooter";

interface PageLayoutProps {
  children: React.ReactNode;
  showFooter?: boolean;
}

const PageLayout = ({ children, showFooter = true }: PageLayoutProps) => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className={showFooter ? "pb-16" : ""}>
        {children}
      </main>
      {showFooter && <GlobalFooter />}
    </div>
  );
};

export default PageLayout;

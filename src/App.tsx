import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { EventProvider } from "@/hooks/useEventContext";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminCourt from "./pages/admin/AdminCourt";
import AdminGroup from "./pages/admin/AdminGroup";
import PublicCourtSelector from "./pages/public/PublicCourtSelector";
import PublicCourt from "./pages/public/PublicCourt";
import PublicGroup from "./pages/public/PublicGroup";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <EventProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/court/:courtId" element={<AdminCourt />} />
            <Route path="/admin/group/:groupId" element={<AdminGroup />} />
            <Route path="/public" element={<PublicCourtSelector />} />
            <Route path="/public/court/:courtId" element={<PublicCourt />} />
            <Route path="/public/group/:groupId" element={<PublicGroup />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </EventProvider>
  </QueryClientProvider>
);

export default App;

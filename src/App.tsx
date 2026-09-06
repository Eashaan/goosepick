import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { EventProvider } from "@/hooks/useEventContext";
import { ParticipantAuthProvider } from "@/hooks/useParticipantAuth";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminDashboard from "./pages/admin/AdminDashboard";
import AdminCourt from "./pages/admin/AdminCourt";
import AdminGroup from "./pages/admin/AdminGroup";
import PublicCourtSelector from "./pages/public/PublicCourtSelector";
import PublicCourt from "./pages/public/PublicCourt";
import PublicGroup from "./pages/public/PublicGroup";
import ParticipantLogin from "./pages/participant/ParticipantLogin";
import AuthCallback from "./pages/participant/AuthCallback";
import MyGoosepick from "./pages/participant/MyGoosepick";
import MyProfile from "./pages/participant/MyProfile";
import MyExperience from "./pages/participant/MyExperience";
import RequireParticipant from "./pages/participant/RequireParticipant";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <EventProvider>
      <ParticipantAuthProvider>
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
              {/* Participant accounts (additive; legacy /public flow untouched) */}
              <Route path="/auth" element={<ParticipantLogin />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route
                path="/my"
                element={
                  <RequireParticipant>
                    <MyGoosepick />
                  </RequireParticipant>
                }
              />
              <Route
                path="/my/profile"
                element={
                  <RequireParticipant requireCompleteProfile={false}>
                    <MyProfile />
                  </RequireParticipant>
                }
              />
              <Route
                path="/my/experience/:registrationId"
                element={
                  <RequireParticipant>
                    <MyExperience />
                  </RequireParticipant>
                }
              />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </ParticipantAuthProvider>
    </EventProvider>
  </QueryClientProvider>
);

export default App;

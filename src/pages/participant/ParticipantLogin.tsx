import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import { useParticipantAuth } from "@/hooks/useParticipantAuth";

const ParticipantLogin = () => {
  const [email, setEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();
  const { user, isLoading, sendMagicLink } = useParticipantAuth();

  useEffect(() => {
    if (!isLoading && user) navigate("/my", { replace: true });
  }, [user, isLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error("Enter a valid email address");
      return;
    }

    setIsSending(true);
    const { error } = await sendMagicLink(value);
    setIsSending(false);

    if (error) {
      toast.error(error);
      return;
    }
    setSent(true);
    toast.success("Link sent. Check your inbox.");
  };

  return (
    <PageLayout>
      <GlobalHeader />
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-foreground">My Goosepick</h1>
            <p className="text-sm text-muted-foreground">
              Enter your email and we'll send you a secure sign-in link. No password needed.
            </p>
          </div>

          {sent ? (
            <div className="space-y-6 text-center">
              <div className="rounded-2xl border border-border bg-card p-6">
                <p className="text-base font-semibold text-foreground">Check your email</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  We sent a sign-in link to <span className="text-primary">{email.trim()}</span>.
                  Open it on this device to continue.
                </p>
              </div>
              <button
                onClick={() => setSent(false)}
                className="text-sm font-medium text-primary underline underline-offset-4"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                type="email"
                inputMode="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14 text-center text-lg bg-secondary border-border rounded-xl"
                autoComplete="email"
                autoFocus
              />
              <Button
                type="submit"
                disabled={isSending || !email.trim()}
                className="w-full h-14 text-lg font-semibold rounded-xl"
              >
                {isSending ? "Sending link..." : "Send sign-in link"}
              </Button>
            </form>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Running an experience today?{" "}
            <button
              onClick={() => navigate("/admin/login")}
              className="text-primary underline underline-offset-4"
            >
              Admin login
            </button>
          </p>
        </div>
      </div>
    </PageLayout>
  );
};

export default ParticipantLogin;

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import { useAdminAuth } from "@/hooks/useAdminAuth";

export const ADMIN_RESEND_COOLDOWN_SECONDS = 60;
export const ADMIN_OTP_LENGTH = 6;
export const isValidAdminOtp = (code: string) =>
  new RegExp(`^\\d{${ADMIN_OTP_LENGTH}}$`).test(code);

/**
 * Staff sign-in. Passwordless 6-digit code by default (same auth identity as the
 * participant portal); password sign-in stays available as a fallback. Either way
 * a staff role is required or the session is signed back out.
 */
const AdminLogin = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"code" | "password">("code");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const navigate = useNavigate();
  const { signIn, sendCode, verifyCode, isAdmin, isLoading: authLoading } = useAdminAuth();

  useEffect(() => {
    if (!authLoading && isAdmin) navigate("/admin", { replace: true });
  }, [isAdmin, authLoading, navigate]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    const value = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error("Enter a valid email address");
      return;
    }
    setBusy(true);
    const { error } = await sendCode(value);
    setBusy(false);
    if (error) {
      toast.error(error);
      return;
    }
    setStep("code");
    setCode("");
    setCooldown(ADMIN_RESEND_COOLDOWN_SECONDS);
    toast.success("Code sent. Check your inbox.");
  };

  const verify = async (value = code) => {
    if (!isValidAdminOtp(value)) return;
    setBusy(true);
    const { error } = await verifyCode(email, value);
    setBusy(false);
    if (error) {
      toast.error(error);
      setCode("");
      return;
    }
    toast.success("Access granted");
    navigate("/admin", { replace: true });
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast.error("Please enter both email and password");
      return;
    }
    setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success("Access granted");
    navigate("/admin", { replace: true });
  };

  if (authLoading) {
    return (
      <PageLayout>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <GlobalHeader />
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-8" data-testid="admin-login">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Admin Login</h1>
            <p className="text-sm text-muted-foreground">
              {mode === "password"
                ? "Enter your admin email and password."
                : step === "email"
                  ? "Enter your staff email and we'll send you a 6-digit code. No password needed."
                  : <>Enter the 6-digit code sent to <span className="text-primary">{email.trim()}</span>.</>}
            </p>
          </div>

          {mode === "password" ? (
            <form onSubmit={submitPassword} className="space-y-4">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-14 text-center text-lg bg-secondary border-border rounded-xl"
                autoFocus
                autoComplete="email"
              />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-14 text-center text-lg bg-secondary border-border rounded-xl"
                autoComplete="current-password"
              />
              <Button
                type="submit"
                disabled={busy || !email || !password}
                className="w-full h-14 text-lg font-semibold rounded-xl"
              >
                {busy ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          ) : step === "email" ? (
            <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="space-y-4">
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
                disabled={busy || !email.trim()}
                className="w-full h-14 text-lg font-semibold rounded-xl"
              >
                {busy ? "Sending code..." : "Send code"}
              </Button>
            </form>
          ) : (
            <div className="space-y-6">
              <div className="flex justify-center">
                <InputOTP
                  maxLength={ADMIN_OTP_LENGTH}
                  value={code}
                  onChange={(v) => {
                    const digits = v.replace(/\D/g, "");
                    setCode(digits);
                    if (digits.length === ADMIN_OTP_LENGTH) void verify(digits);
                  }}
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                >
                  <InputOTPGroup>
                    {Array.from({ length: ADMIN_OTP_LENGTH }, (_, i) => (
                      <InputOTPSlot key={i} index={i} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button
                onClick={() => verify()}
                disabled={busy || !isValidAdminOtp(code)}
                className="w-full h-14 text-lg font-semibold rounded-xl"
              >
                {busy ? "Checking..." : "Sign in"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => setStep("email")}
                  className="font-medium text-muted-foreground underline underline-offset-4"
                >
                  Change email
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={cooldown > 0 || busy}
                  className="font-medium text-primary underline underline-offset-4 disabled:text-muted-foreground disabled:no-underline"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => {
                setMode(mode === "password" ? "code" : "password");
                setStep("email");
                setCode("");
                setPassword("");
              }}
              className="text-primary underline underline-offset-4"
            >
              {mode === "password" ? "Use a sign-in code instead" : "Use a password instead"}
            </button>
          </p>
        </div>
      </div>
    </PageLayout>
  );
};

export default AdminLogin;

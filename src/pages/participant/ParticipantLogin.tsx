import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import { useParticipantAuth } from "@/hooks/useParticipantAuth";
import { sanitizeNextPath } from "@/lib/authVerify";

export const RESEND_COOLDOWN_SECONDS = 60;
export const OTP_LENGTH = 6;
export const isValidOtp = (code: string) => new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code);

const ParticipantLogin = () => {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const navigate = useNavigate();
  const { user, isLoading, sendMagicLink, verifyEmailCode } = useParticipantAuth();
  const next = sanitizeNextPath(new URLSearchParams(window.location.search).get("next"));

  useEffect(() => {
    if (!isLoading && user) navigate(next, { replace: true });
  }, [user, isLoading, navigate, next]);

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
    const { error } = await sendMagicLink(value);
    setBusy(false);
    if (error) {
      toast.error(error);
      return;
    }
    setStep("code");
    setCode("");
    setCooldown(RESEND_COOLDOWN_SECONDS);
    toast.success("Code sent. Check your inbox.");
  };

  const verify = async (value = code) => {
    if (!isValidOtp(value)) return;
    setBusy(true);
    const { error } = await verifyEmailCode(email, value);
    setBusy(false);
    if (error) {
      toast.error("That code didn't work. Check it or request a new one.");
      setCode("");
    }
    // Success: the auth listener sets the user and the effect above navigates.
  };

  return (
    <PageLayout>
      <GlobalHeader />
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-foreground">My Goosepick</h1>
            <p className="text-sm text-muted-foreground">
              {step === "email"
                ? "Enter your email and we'll send you a 6-digit sign-in code. No password needed."
                : <>Enter the 6-digit code sent to <span className="text-primary">{email.trim()}</span>.</>}
            </p>
          </div>

          {step === "email" ? (
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
              <Button type="submit" disabled={busy || !email.trim()} className="w-full h-14 text-lg font-semibold rounded-xl">
                {busy ? "Sending code..." : "Send code"}
              </Button>
            </form>
          ) : (
            <div className="space-y-6">
              <div className="flex justify-center">
                <InputOTP
                  maxLength={OTP_LENGTH}
                  value={code}
                  onChange={(v) => {
                    const digits = v.replace(/\D/g, "");
                    setCode(digits);
                    if (digits.length === OTP_LENGTH) void verify(digits);
                  }}
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                >
                  <InputOTPGroup>
                    {Array.from({ length: OTP_LENGTH }, (_, i) => <InputOTPSlot key={i} index={i} />)}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              <Button onClick={() => verify()} disabled={busy || !isValidOtp(code)} className="w-full h-14 text-lg font-semibold rounded-xl">
                {busy ? "Checking..." : "Sign in"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button onClick={() => setStep("email")} className="font-medium text-muted-foreground underline underline-offset-4">
                  Change email
                </button>
                <button
                  onClick={send}
                  disabled={cooldown > 0 || busy}
                  className="font-medium text-primary underline underline-offset-4 disabled:text-muted-foreground disabled:no-underline"
                >
                  {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                </button>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                The email also contains a sign-in button if you prefer to use it on this device.
              </p>
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Running an experience today?{" "}
            <button onClick={() => navigate("/admin/login")} className="text-primary underline underline-offset-4">
              Admin login
            </button>
          </p>
        </div>
      </div>
    </PageLayout>
  );
};

export default ParticipantLogin;

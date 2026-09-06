import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import PageLayout from "@/components/layout/PageLayout";
import GlobalHeader from "@/components/layout/GlobalHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useParticipantAuth } from "@/hooks/useParticipantAuth";
import { participantDb } from "@/integrations/supabase/participantDb";

/** Permissive Indian mobile validation: 10 digits, optional +91 / 0 prefix. */
const normalizePhone = (raw: string): string | null => {
  const digits = raw.replace(/[^\d]/g, "");
  const local = digits.replace(/^(91|0)(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
};

const MyProfile = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, refreshProfile, isLoading } = useParticipantAuth();
  // Only ever return to an in-app participant path (set by RequireParticipant).
  const rawFrom = (location.state as { from?: unknown } | null)?.from;
  const returnTo = typeof rawFrom === "string" && rawFrom.startsWith("/my") ? rawFrom : "/my";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setFirstName(profile.first_name ?? "");
    setLastName(profile.last_name ?? "");
    setPhone(profile.phone ? profile.phone.replace(/^\+91/, "") : "");
  }, [profile]);

  const email = profile?.email ?? user?.email ?? "";

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!firstName.trim()) {
      toast.error("Please enter your name");
      return;
    }
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      toast.error("Enter a valid 10-digit Indian mobile number");
      return;
    }

    setSaving(true);
    // Scoped to the signed-in user only — another person's profile can never be
    // targeted, and the database policies enforce the same rule.
    const payload = {
      user_id: user.id,
      email: (user.email ?? email).toLowerCase(),
      first_name: firstName.trim(),
      last_name: lastName.trim() || null,
      phone: normalizedPhone,
    };

    const { error } = profile
      ? await participantDb
          .from("participant_profiles")
          .update(payload)
          .eq("user_id", user.id)
      : await participantDb.from("participant_profiles").insert(payload);

    setSaving(false);

    if (error) {
      toast.error(error.message || "Could not save your details");
      return;
    }

    await refreshProfile();
    toast.success("Details saved");
    navigate(returnTo, { replace: true });
  };

  return (
    <PageLayout>
      <GlobalHeader />
      <div className="mx-auto w-full max-w-md px-6 py-10">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-foreground">
            {profile?.first_name ? "Your details" : "Welcome to Goosepick"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {profile?.first_name
              ? "Update how you appear on rosters and how we reach you."
              : "Just two quick things so we can put you on the right roster."}
          </p>
        </div>

        <form onSubmit={handleSave} className="mt-8 space-y-5">
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Email</Label>
            <Input
              value={email}
              readOnly
              disabled
              className="h-14 bg-secondary border-border rounded-xl text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="firstName" className="text-sm text-muted-foreground">
              Name shown on rosters
            </Label>
            <Input
              id="firstName"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Eashaan"
              className="h-14 bg-secondary border-border rounded-xl text-lg"
              autoFocus={!profile?.first_name}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lastName" className="text-sm text-muted-foreground">
              Last name (optional)
            </Label>
            <Input
              id="lastName"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Balwani"
              className="h-14 bg-secondary border-border rounded-xl text-lg"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone" className="text-sm text-muted-foreground">
              Mobile number
            </Label>
            <div className="flex items-center gap-2">
              <span className="flex h-14 items-center rounded-xl border border-border bg-secondary px-4 text-lg text-muted-foreground">
                +91
              </span>
              <Input
                id="phone"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210"
                className="h-14 flex-1 bg-secondary border-border rounded-xl text-lg"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Only used for experience updates. Never shown on public rosters.
            </p>
          </div>

          <Button
            type="submit"
            disabled={saving || isLoading}
            className="w-full h-14 text-lg font-semibold rounded-xl"
          >
            {saving ? "Saving..." : "Save and continue"}
          </Button>
        </form>
      </div>
    </PageLayout>
  );
};

export default MyProfile;

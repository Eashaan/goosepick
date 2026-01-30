import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import PageLayout from "@/components/layout/PageLayout";

const ADMIN_PASSWORD = "GPS0126";

const AdminLogin = () => {
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Case-insensitive password check
    if (password.toUpperCase() === ADMIN_PASSWORD.toUpperCase()) {
      localStorage.setItem("gp_admin_unlocked", "true");
      toast.success("Access granted");
      navigate("/admin");
    } else {
      toast.error("Invalid password");
    }

    setIsLoading(false);
  };

  return (
    <PageLayout>
      <div className="flex min-h-screen flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">Admin Login</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Enter the admin password to continue
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-14 text-center text-lg bg-secondary border-border rounded-xl"
              autoFocus
            />

            <Button
              type="submit"
              disabled={isLoading || !password}
              className="w-full h-14 text-lg font-semibold rounded-xl"
            >
              {isLoading ? "Verifying..." : "Enter"}
            </Button>
          </form>
        </div>
      </div>
    </PageLayout>
  );
};

export default AdminLogin;

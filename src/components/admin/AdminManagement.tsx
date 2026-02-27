import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Trash2, Plus, Loader2 } from "lucide-react";

interface Admin {
  user_id: string;
  email: string;
}

interface AdminManagementProps {
  currentUserId: string;
}

const AdminManagement = ({ currentUserId }: AdminManagementProps) => {
  const [open, setOpen] = useState(false);
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchAdmins = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-admins", {
        body: { action: "list" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAdmins(data.admins || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load admins");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchAdmins();
  }, [open]);

  const handleAdd = async () => {
    if (!email.trim()) return;
    setAdding(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-admins", {
        body: { action: "add", email: email.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`${email.trim()} added as admin`);
      setEmail("");
      fetchAdmins();
    } catch (err: any) {
      toast.error(err.message || "Failed to add admin");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setRemovingId(userId);
    try {
      const { data, error } = await supabase.functions.invoke("manage-admins", {
        body: { action: "remove", user_id: userId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Admin removed");
      fetchAdmins();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove admin");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Manage Admins">
          <Users className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Admins</DialogTitle>
        </DialogHeader>

        {/* Add admin */}
        <div className="flex gap-2">
          <Input
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            disabled={adding}
          />
          <Button onClick={handleAdd} disabled={adding || !email.trim()} size="icon">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The user must have an existing account to be added as admin.
        </p>

        {/* Admin list */}
        <div className="mt-2 space-y-2">
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : admins.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No admins found</p>
          ) : (
            admins.map((a) => (
              <div
                key={a.user_id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <span className="text-sm truncate">
                  {a.email}
                  {a.user_id === currentUserId && (
                    <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  disabled={a.user_id === currentUserId || removingId === a.user_id}
                  onClick={() => handleRemove(a.user_id)}
                >
                  {removingId === a.user_id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AdminManagement;

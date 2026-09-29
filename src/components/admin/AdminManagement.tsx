import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, Trash2, Plus, Loader2 } from "lucide-react";
import { ROLE_LABELS, STAFF_ROLES, isStaffRole, wouldRemoveLastOwner, type StaffRole } from "@/lib/rbac";

interface StaffMember {
  user_id: string;
  email: string;
  role: StaffRole;
}

interface AdminManagementProps {
  currentUserId: string;
}

/** Owner-only role management (server enforces owner + last-owner protection). */
const AdminManagement = ({ currentUserId }: AdminManagementProps) => {
  const [open, setOpen] = useState(false);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<StaffRole>("host");
  const [busyId, setBusyId] = useState<string | null>(null);

  const call = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("manage-admins", { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const data = await call({ action: "list" });
      setStaff(((data.staff || data.admins || []) as any[]).filter((s) => isStaffRole(s.role)));
    } catch (err: any) {
      toast.error(err.message || "Failed to load staff");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchStaff();
  }, [open]);

  const handleAdd = async () => {
    if (!email.trim()) return;
    setBusyId("new");
    try {
      await call({ action: "set_role", email: email.trim(), role: newRole });
      toast.success(`${email.trim()} is now ${ROLE_LABELS[newRole]}`);
      setEmail("");
      fetchStaff();
    } catch (err: any) {
      toast.error(err.message || "Failed to add staff");
    } finally {
      setBusyId(null);
    }
  };

  const handleRoleChange = async (member: StaffMember, role: StaffRole) => {
    if (wouldRemoveLastOwner(staff, member.user_id, role)) {
      toast.error("You can't demote the last owner. Make someone else owner first.");
      return;
    }
    setBusyId(member.user_id);
    try {
      await call({ action: "set_role", user_id: member.user_id, role });
      toast.success(`${member.email} is now ${ROLE_LABELS[role]}`);
      fetchStaff();
    } catch (err: any) {
      toast.error(err.message || "Failed to change role");
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (member: StaffMember) => {
    if (wouldRemoveLastOwner(staff, member.user_id, null)) {
      toast.error("You can't remove the last owner.");
      return;
    }
    setBusyId(member.user_id);
    try {
      await call({ action: "remove", user_id: member.user_id });
      toast.success("Access removed");
      fetchStaff();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove access");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="Manage staff roles">
          <Users className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Staff roles</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            disabled={busyId === "new"}
          />
          <Select value={newRole} onValueChange={(v) => setNewRole(v as StaffRole)}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STAFF_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button onClick={handleAdd} disabled={busyId === "new" || !email.trim()} size="icon" aria-label="Add staff">
            {busyId === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The person must have signed in to Goosepick once. Owner: everything. Admin: events, schedules, capacity, Shopify.
          Host: event-day seats, rosters and scoring. Viewer: read-only.
        </p>

        <div className="mt-2 space-y-2">
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : staff.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No staff found</p>
          ) : (
            staff.map((m) => {
              const lastOwner = wouldRemoveLastOwner(staff, m.user_id, null);
              return (
                <div key={m.user_id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2">
                  <span className="flex-1 truncate text-sm">
                    {m.email}
                    {m.user_id === currentUserId && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                  </span>
                  <Select
                    value={m.role}
                    onValueChange={(v) => handleRoleChange(m, v as StaffRole)}
                    disabled={busyId === m.user_id}
                  >
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STAFF_ROLES.map((r) => (
                        <SelectItem key={r} value={r} disabled={lastOwner && r !== "owner"}>{ROLE_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    disabled={m.user_id === currentUserId || lastOwner || busyId === m.user_id}
                    onClick={() => handleRemove(m)}
                    aria-label={`Remove ${m.email}`}
                  >
                    {busyId === m.user_id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AdminManagement;

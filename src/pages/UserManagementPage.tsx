import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Users, Mail, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface TeamMember {
  user_id: string;
  role: AppRole;
  full_name: string | null;
  avatar_url: string | null;
}

interface Invitation {
  id: string;
  email: string;
  role: AppRole;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export default function UserManagementPage() {
  const { tenantId, isTenantAdmin, isSuperAdmin, user } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("staff");
  const [sending, setSending] = useState(false);

  const canManage = isTenantAdmin || isSuperAdmin;

  const fetchData = async () => {
    if (!tenantId) { setLoading(false); return; }

    const [rolesRes, invRes] = await Promise.all([
      supabase
        .from("user_roles")
        .select("user_id, role")
        .eq("tenant_id", tenantId),
      supabase
        .from("user_invitations")
        .select("id, email, role, accepted_at, expires_at, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
    ]);

    if (rolesRes.data && rolesRes.data.length > 0) {
      const userIds = rolesRes.data.map((r) => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", userIds);

      const merged: TeamMember[] = rolesRes.data.map((r) => {
        const p = profiles?.find((pr) => pr.user_id === r.user_id);
        return { user_id: r.user_id, role: r.role, full_name: p?.full_name ?? null, avatar_url: p?.avatar_url ?? null };
      });
      setMembers(merged);
    }

    if (invRes.data) setInvitations(invRes.data);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [tenantId]);

  const handleInvite = async () => {
    if (!inviteEmail.trim()) { toast.error("Enter an email"); return; }
    if (!tenantId || !user) return;
    setSending(true);
    const { error } = await supabase.from("user_invitations").insert({
      tenant_id: tenantId,
      email: inviteEmail.trim(),
      role: inviteRole,
      invited_by: user.id,
    });
    setSending(false);
    if (error) { toast.error(error.message); } else {
      toast.success(`Invitation sent to ${inviteEmail}`);
      setOpen(false);
      setInviteEmail("");
      setInviteRole("staff");
      fetchData();
    }
  };

  const roleColor = (r: AppRole) =>
    r === "super_admin" ? "bg-destructive/10 text-destructive" : r === "tenant_admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground";

  return (
    <>
      <TopBar title="Team Management" />
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {/* Team Members */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">Team Members</h2>
              <Badge variant="secondary">{members.length}</Badge>
            </div>
            {canManage && (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><UserPlus className="w-4 h-4" /> Invite</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label>Email</Label>
                      <Input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@company.com" />
                    </div>
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="staff">Staff</SelectItem>
                          <SelectItem value="tenant_admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button className="w-full" onClick={handleInvite} disabled={sending}>
                      {sending && <Loader2 className="w-4 h-4 animate-spin" />} Send Invitation
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : members.length === 0 ? (
            <p className="text-muted-foreground text-sm">No team members yet.</p>
          ) : (
            <div className="space-y-2">
              {members.map((m) => (
                <div key={m.user_id} className="glass-card rounded-xl p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                    {(m.full_name || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{m.full_name || "Unknown"}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColor(m.role)}`}>
                    {m.role.replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pending Invitations */}
        {canManage && invitations.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Mail className="w-5 h-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold text-foreground">Pending Invitations</h2>
            </div>
            <div className="space-y-2">
              {invitations.filter((i) => !i.accepted_at).map((inv) => (
                <div key={inv.id} className="glass-card rounded-xl p-4 flex items-center gap-3">
                  <Mail className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate">{inv.email}</p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      Expires {new Date(inv.expires_at).toLocaleDateString()}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColor(inv.role)}`}>
                    {inv.role.replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

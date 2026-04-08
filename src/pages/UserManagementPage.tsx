import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UserPlus, Users, Loader2, MoreHorizontal, Pencil, Trash2, KeyRound, Eye, EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface TeamMember {
  user_id: string;
  role: AppRole;
  full_name: string | null;
  phone: string | null;
}

export default function UserManagementPage() {
  const { tenantId, isTenantAdmin, isSuperAdmin, user, session } = useAuth();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "", role: "staff" as string });

  const canManage = isTenantAdmin || isSuperAdmin;

  const fetchData = async () => {
    if (!tenantId) { setLoading(false); return; }
    const { data: rolesData } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("tenant_id", tenantId);

    if (rolesData && rolesData.length > 0) {
      const userIds = rolesData.map(r => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, phone")
        .in("user_id", userIds);

      const merged: TeamMember[] = rolesData.map(r => {
        const p = profiles?.find(pr => pr.user_id === r.user_id);
        return {
          user_id: r.user_id,
          role: r.role,
          full_name: p?.full_name ?? null,
          phone: p?.phone ?? null,
        };
      });
      setMembers(merged);
    } else {
      setMembers([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [tenantId]);

  const callManageTeam = async (action: string, body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("manage-team", {
      body,
      headers: { "Content-Type": "application/json" },
    });
    if (error) throw new Error(error.message || "Request failed");
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSubmitting(true);
    try {
      if (editingMember) {
        await callManageTeam("update", {
          user_id: editingMember.user_id,
          name: form.name,
          phone: form.phone,
          role: form.role,
        });
        toast.success("Team member updated");
      } else {
        if (!form.email.trim() || !form.password) {
          toast.error("Email and password are required");
          setSubmitting(false);
          return;
        }
        await callManageTeam("create", {
          name: form.name,
          phone: form.phone,
          email: form.email,
          password: form.password,
          role: form.role,
          tenant_id: tenantId,
        });
        toast.success("Team member created");
      }
      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (member: TeamMember) => {
    if (!window.confirm(`Delete ${member.full_name || "this member"}? This cannot be undone.`)) return;
    try {
      await callManageTeam("delete", { user_id: member.user_id });
      toast.success("Team member deleted");
      fetchData();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleResetPassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSubmitting(true);
    try {
      await callManageTeam("reset-password", { user_id: resetUserId, new_password: newPassword });
      toast.success("Password reset successfully");
      setResetDialogOpen(false);
      setNewPassword("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openCreate = () => {
    setEditingMember(null);
    setForm({ name: "", phone: "", email: "", password: "", role: "staff" });
    setDialogOpen(true);
  };

  const openEdit = (m: TeamMember) => {
    setEditingMember(m);
    setForm({ name: m.full_name || "", phone: m.phone || "", email: "", password: "", role: m.role });
    setDialogOpen(true);
  };

  const resetForm = () => {
    setForm({ name: "", phone: "", email: "", password: "", role: "staff" });
    setEditingMember(null);
  };

  const roleLabel = (r: AppRole) =>
    r === "super_admin" ? "Super Admin" : r === "tenant_admin" ? "Admin / Manager" : "Executive";

  const roleColor = (r: AppRole) =>
    r === "super_admin" ? "bg-destructive/10 text-destructive" : r === "tenant_admin" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground";

  return (
    <>
      <TopBar title="Team Management" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Team Members</h2>
            <Badge variant="secondary">{members.length}</Badge>
          </div>
          {canManage && (
            <Button size="sm" onClick={openCreate}>
              <UserPlus className="w-4 h-4 mr-1" /> Add Member
            </Button>
          )}
        </div>

        {/* Team Table */}
        <div className="glass-card rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50">
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Role</TableHead>
                {canManage && <TableHead className="w-12"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : members.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    No team members yet
                  </TableCell>
                </TableRow>
              ) : members.map(m => (
                <TableRow key={m.user_id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                        {(m.full_name || "?")[0].toUpperCase()}
                      </div>
                      <span className="font-medium text-foreground">{m.full_name || "Unknown"}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{m.phone || "—"}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColor(m.role)}`}>
                      {roleLabel(m.role)}
                    </span>
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      {m.user_id !== user?.id && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(m)}>
                              <Pencil className="w-4 h-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setResetUserId(m.user_id); setNewPassword(""); setResetDialogOpen(true); }}>
                              <KeyRound className="w-4 h-4 mr-2" /> Reset Password
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(m)}>
                              <Trash2 className="w-4 h-4 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Create/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingMember ? "Edit Team Member" : "Add Team Member"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="John Doe" />
              </div>
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91 9876543210" />
              </div>
              {!editingMember && (
                <>
                  <div className="space-y-2">
                    <Label>Email (Login Username) *</Label>
                    <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="executive@dealer.com" />
                  </div>
                  <div className="space-y-2">
                    <Label>Password *</Label>
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                        placeholder="Min 6 characters"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </>
              )}
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="staff">Executive</SelectItem>
                    <SelectItem value="tenant_admin">Manager / Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                {editingMember ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reset Password Dialog */}
        <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset Password</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>New Password</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Min 6 characters"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleResetPassword} disabled={submitting}>
                {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Reset Password
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

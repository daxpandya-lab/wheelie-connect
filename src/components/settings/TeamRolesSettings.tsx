import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { UserPlus, Users, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface Member {
  user_id: string;
  role: AppRole;
  full_name: string | null;
  email: string | null;
  initial_password: string | null;
  pipeline: number;
  status: "Active" | "Inactive";
}

const roleLabel = (r: AppRole) =>
  r === "super_admin" ? "Super Admin" : r === "tenant_admin" ? "Admin / Manager" : "Executive";

const roleTone = (r: AppRole) =>
  r === "super_admin" ? "bg-destructive/10 text-destructive" :
  r === "tenant_admin" ? "bg-primary/10 text-primary" :
  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";

export default function TeamRolesSettings() {
  const { tenantId, isTenantAdmin, isSuperAdmin } = useAuth();
  const canManage = isTenantAdmin || isSuperAdmin;
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ name: "", email: "", password: "" });

  const fetchTeam = async () => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data } = await supabase.functions.invoke("manage-team", {
        body: { action: "list", tenant_id: tenantId },
      });
      const raw: any[] = data?.members || [];
      const ids = raw.map((r) => r.user_id);

      // Assigned pipeline volume = open leads + non-terminal service bookings per user
      const [{ data: leads }, { data: bookings }] = await Promise.all([
        supabase.from("leads").select("assigned_to, status").eq("tenant_id", tenantId).in("assigned_to", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
        supabase.from("service_bookings").select("assigned_to, status").eq("tenant_id", tenantId).in("assigned_to", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      ]);

      const count: Record<string, number> = {};
      const openLead = (s: string | null) => s !== "converted" && s !== "lost" && s !== "closed";
      const openBooking = (s: string | null) => s !== "completed" && s !== "cancelled";
      (leads || []).forEach((r: any) => { if (r.assigned_to && openLead(r.status)) count[r.assigned_to] = (count[r.assigned_to] || 0) + 1; });
      (bookings || []).forEach((r: any) => { if (r.assigned_to && openBooking(r.status)) count[r.assigned_to] = (count[r.assigned_to] || 0) + 1; });

      setMembers(raw.map((r) => ({
        user_id: r.user_id,
        role: r.role,
        full_name: r.full_name,
        email: r.email,
        initial_password: r.initial_password,
        pipeline: count[r.user_id] || 0,
        status: "Active",
      })));
    } catch (e: any) {
      toast.error(e.message || "Failed to load team");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTeam(); }, [tenantId]);

  const invite = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password) {
      toast.error("Name, email and password are required");
      return;
    }
    if (form.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-team", {
        body: {
          action: "create",
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: "staff",
          tenant_id: tenantId,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success("Executive account created and scoped to this dealership");
      setForm({ name: "", email: "", password: "" });
      setOpen(false);
      fetchTeam();
    } catch (e: any) {
      toast.error(e.message || "Failed to invite");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-base font-semibold text-foreground">Team Members</h3>
            <Badge variant="secondary">{members.length}</Badge>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <UserPlus className="w-4 h-4 mr-1" /> Invite Team Member
            </Button>
          )}
        </div>

        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/50">
                <TableHead>Staff Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Pipeline</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Initial Password</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              ) : members.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No team members yet — invite your first executive.</TableCell></TableRow>
              ) : members.map((m) => (
                <TableRow key={m.user_id}>
                  <TableCell className="font-medium text-foreground">{m.full_name || "Unknown"}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{m.email || "—"}</TableCell>
                  <TableCell>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleTone(m.role)}`}>
                      {roleLabel(m.role)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{m.pipeline}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {m.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    {m.initial_password ? (
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs">{reveal[m.user_id] ? m.initial_password : "••••••••"}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setReveal((p) => ({ ...p, [m.user_id]: !p[m.user_id] }))}>
                          {reveal[m.user_id] ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                        </Button>
                      </div>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          New executives are automatically scoped to this dealership and appear as assignable owners in Leads and Service Bookings.
        </p>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Team Member (Executive)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Full Name *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Jane Executive" />
            </div>
            <div className="space-y-2">
              <Label>Active Login Email *</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="jane@dealer.com" />
            </div>
            <div className="space-y-2">
              <Label>Initial Password *</Label>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Min 6 characters"
                />
                <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7" onClick={() => setShowPw((v) => !v)}>
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Share with the executive. They can change it after first login.</p>
            </div>
            <p className="text-xs text-muted-foreground">
              This account will be created with the <strong>Executive</strong> role and permanently bound to this dealership's tenant.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={invite} disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Create Executive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Loader2, Pencil, KeyRound, Ban, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type TenantPlan = Database["public"]["Enums"]["tenant_plan"];
type TenantStatus = Database["public"]["Enums"]["tenant_status"];

interface Tenant {
  id: string;
  name: string;
  slug: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  plan: TenantPlan;
  status: TenantStatus;
  subscription_start_date: string | null;
  subscription_end_date: string | null;
  created_at: string;
}

const emptyForm = {
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  password: "",
  plan: "free" as TenantPlan,
  status: "active" as TenantStatus,
  startDate: "",
  endDate: "",
};

export default function SuperAdminPage() {
  const { isSuperAdmin } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState<Partial<Tenant> & { id: string }>({ id: "" });
  const [resetTarget, setResetTarget] = useState<Tenant | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchTenants = useCallback(async () => {
    const { data } = await supabase
      .from("tenants")
      .select("*")
      .order("created_at", { ascending: false });
    if (data) setTenants(data as unknown as Tenant[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchTenants(); }, [fetchTenants]);

  const callEdgeFn = async (action: string, body: Record<string, unknown>) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await supabase.functions.invoke("manage-dealer", {
      body,
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
      },
    });

    // The query parameter needs to go through the URL
    // Actually supabase.functions.invoke doesn't support query params easily
    // Let's include action in the body instead
    return res;
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
      toast.error("Name, email and password are required");
      return;
    }
    setSaving(true);

    const { data: { session } } = await supabase.auth.getSession();
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const url = `https://${projectId}.supabase.co/functions/v1/manage-dealer?action=create`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          name: form.name,
          contact_person: form.contact_person,
          phone: form.phone,
          email: form.email,
          address: form.address,
          password: form.password,
          plan: form.plan,
          status: form.status,
          start_date: form.startDate || null,
          end_date: form.endDate || null,
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to create dealer");

      toast.success("Dealer created with login credentials");
      setCreateOpen(false);
      setForm(emptyForm);
      fetchTenants();
    } catch (err: any) {
      toast.error(err.message);
    }
    setSaving(false);
  };

  const handleEdit = async () => {
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const url = `https://${projectId}.supabase.co/functions/v1/manage-dealer?action=update`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          id: editForm.id,
          name: editForm.name,
          contact_person: editForm.contact_person,
          phone: editForm.phone,
          email: editForm.email,
          address: editForm.address,
          plan: editForm.plan,
          status: editForm.status,
          start_date: editForm.subscription_start_date,
          end_date: editForm.subscription_end_date,
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to update dealer");

      toast.success("Dealer updated");
      setEditOpen(false);
      fetchTenants();
    } catch (err: any) {
      toast.error(err.message);
    }
    setSaving(false);
  };

  const handleResetPassword = async () => {
    if (!newPassword.trim() || newPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const url = `https://${projectId}.supabase.co/functions/v1/manage-dealer?action=reset-password`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          tenant_id: resetTarget?.id,
          new_password: newPassword,
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to reset password");

      toast.success("Password reset successfully");
      setResetOpen(false);
      setNewPassword("");
    } catch (err: any) {
      toast.error(err.message);
    }
    setSaving(false);
  };

  const handleToggleStatus = async (tenant: Tenant) => {
    const newStatus: TenantStatus = tenant.status === "active" ? "suspended" : "active";
    const { error } = await supabase
      .from("tenants")
      .update({ status: newStatus })
      .eq("id", tenant.id);
    if (error) toast.error(error.message);
    else {
      toast.success(`Dealer ${newStatus === "active" ? "activated" : "suspended"}`);
      fetchTenants();
    }
  };

  const openEdit = (t: Tenant) => {
    setEditForm({
      id: t.id,
      name: t.name,
      contact_person: t.contact_person,
      phone: t.phone,
      email: t.email,
      address: t.address,
      plan: t.plan,
      status: t.status,
      subscription_start_date: t.subscription_start_date?.split("T")[0] || "",
      subscription_end_date: t.subscription_end_date?.split("T")[0] || "",
    });
    setEditOpen(true);
  };

  const statusColor = (s: TenantStatus) =>
    s === "active"
      ? "bg-success/10 text-success"
      : s === "suspended"
      ? "bg-warning/10 text-warning"
      : "bg-destructive/10 text-destructive";

  const generatePassword = () => {
    const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
    let pw = "";
    for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    return pw;
  };

  if (!isSuperAdmin) return <div className="p-6 text-muted-foreground">Access denied</div>;

  return (
    <>
      <TopBar title="Super Admin — Dealer Management" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <p className="text-muted-foreground">{tenants.length} dealer(s) registered</p>
          </div>
          <Button onClick={() => { setForm(emptyForm); setCreateOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Add Dealer
          </Button>
        </div>

        {/* Dealer Table */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dealer Name</TableHead>
                  <TableHead>Contact Person</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>End Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tenants.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                      No dealers found. Click "Add Dealer" to create one.
                    </TableCell>
                  </TableRow>
                ) : (
                  tenants.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell>{t.contact_person || "—"}</TableCell>
                      <TableCell>{t.phone || "—"}</TableCell>
                      <TableCell>{t.email || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{t.plan}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(t.status)}`}>
                          {t.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {t.subscription_start_date
                          ? new Date(t.subscription_start_date).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {t.subscription_end_date
                          ? new Date(t.subscription_end_date).toLocaleDateString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Edit" onClick={() => openEdit(t)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Reset Password" onClick={() => { setResetTarget(t); setNewPassword(""); setResetOpen(true); }}>
                            <KeyRound className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title={t.status === "active" ? "Suspend" : "Activate"} onClick={() => handleToggleStatus(t)}>
                            {t.status === "active" ? (
                              <Ban className="w-4 h-4 text-warning" />
                            ) : (
                              <CheckCircle className="w-4 h-4 text-success" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* CREATE DIALOG */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New Dealer</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Dealer Name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Motors" />
              </div>
              <div className="space-y-2">
                <Label>Contact Person Name</Label>
                <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} placeholder="John Doe" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
                </div>
                <div className="space-y-2">
                  <Label>Email * (used for login)</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="dealer@example.com" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Business Address</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="123 Main St, City" />
              </div>
              <div className="space-y-2">
                <Label>Password *</Label>
                <div className="flex gap-2">
                  <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters" />
                  <Button variant="outline" type="button" onClick={() => setForm({ ...form, password: generatePassword() })}>
                    Generate
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v as TenantPlan })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as TenantStatus })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </div>
              </div>
              <Button className="w-full" onClick={handleCreate} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Create Dealer
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* EDIT DIALOG */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Dealer</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Dealer Name</Label>
                <Input value={editForm.name || ""} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Contact Person</Label>
                <Input value={editForm.contact_person || ""} onChange={(e) => setEditForm({ ...editForm, contact_person: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input value={editForm.phone || ""} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input value={editForm.email || ""} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Address</Label>
                <Input value={editForm.address || ""} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Plan</Label>
                  <Select value={editForm.plan || "free"} onValueChange={(v) => setEditForm({ ...editForm, plan: v as TenantPlan })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="enterprise">Enterprise</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={editForm.status || "active"} onValueChange={(v) => setEditForm({ ...editForm, status: v as TenantStatus })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="suspended">Suspended</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Start Date</Label>
                  <Input type="date" value={editForm.subscription_start_date || ""} onChange={(e) => setEditForm({ ...editForm, subscription_start_date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>End Date</Label>
                  <Input type="date" value={editForm.subscription_end_date || ""} onChange={(e) => setEditForm({ ...editForm, subscription_end_date: e.target.value })} />
                </div>
              </div>
              <Button className="w-full" onClick={handleEdit} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Save Changes
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* RESET PASSWORD DIALOG */}
        <Dialog open={resetOpen} onOpenChange={setResetOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset Password — {resetTarget?.name}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <p className="text-sm text-muted-foreground">
                Set a new password for the tenant admin of <strong>{resetTarget?.name}</strong> ({resetTarget?.email}).
              </p>
              <div className="space-y-2">
                <Label>New Password</Label>
                <div className="flex gap-2">
                  <Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 6 characters" />
                  <Button variant="outline" type="button" onClick={() => setNewPassword(generatePassword())}>
                    Generate
                  </Button>
                </div>
              </div>
              <Button className="w-full" onClick={handleResetPassword} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Reset Password
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

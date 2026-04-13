import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Car, Loader2, Search, Bot, User } from "lucide-react";
import { toast } from "sonner";

const statusColors: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  confirmed: "bg-primary/10 text-primary",
  in_progress: "bg-info/10 text-info",
  completed: "bg-success/10 text-success",
  cancelled: "bg-destructive/10 text-destructive",
};

function SourceBadge({ source }: { source: string }) {
  if (source === "ai_bot") {
    return <Badge variant="outline" className="text-xs gap-1 bg-primary/10 text-primary border-primary/20"><Bot className="w-3 h-3" />AI Bot</Badge>;
  }
  return <Badge variant="outline" className="text-xs gap-1 bg-muted text-muted-foreground"><User className="w-3 h-3" />Manual</Badge>;
}

export default function TestDrivesPage() {
  const { tenantId } = useAuth();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [form, setForm] = useState({
    customer_name: "", phone_number: "", vehicle_model: "",
    preferred_date: "", preferred_time: "", license_status: "verified",
    visit_type: "showroom", notes: "",
  });

  const fetchBookings = async () => {
    if (!tenantId) return;
    let query = supabase.from("test_drive_bookings")
      .select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
    if (sourceFilter !== "all") query = query.eq("booking_source", sourceFilter);
    const { data } = await query;
    if (data) setBookings(data);
    setLoading(false);
  };

  useEffect(() => { fetchBookings(); }, [tenantId, sourceFilter]);

  const filtered = bookings.filter(td => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return td.customer_name?.toLowerCase().includes(s) || td.vehicle_model?.toLowerCase().includes(s) || td.phone_number?.includes(s);
  });

  const handleCreate = async () => {
    if (!form.customer_name.trim() || !form.phone_number.trim() || !form.vehicle_model.trim() || !form.preferred_date) {
      toast.error("Please fill required fields"); return;
    }
    if (!tenantId) return;
    setSaving(true);
    const { error } = await supabase.from("test_drive_bookings").insert({
      tenant_id: tenantId,
      customer_name: form.customer_name,
      phone_number: form.phone_number,
      vehicle_model: form.vehicle_model,
      preferred_date: form.preferred_date,
      preferred_time: form.preferred_time || null,
      booking_source: "manual",
      notes: [
        form.license_status === "verified" ? "License: Verified" : "License: Pending",
        `Visit: ${form.visit_type === "home" ? "Home Visit" : "Showroom"}`,
        form.notes,
      ].filter(Boolean).join(" | "),
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Test drive scheduled");
      setCreateOpen(false);
      setForm({ customer_name: "", phone_number: "", vehicle_model: "", preferred_date: "", preferred_time: "", license_status: "verified", visit_type: "showroom", notes: "" });
      fetchBookings();
    }
    setSaving(false);
  };

  return (
    <>
      <TopBar title="Test Drives" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="relative min-w-[200px] flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search name, model, phone..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 text-sm" />
            </div>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="ai_bot">AI Bot</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> Schedule Test Drive</Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">No test drives found.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((td) => (
              <div key={td.id} className="glass-card rounded-xl p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Car className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{td.vehicle_model}</p>
                      <p className="text-xs text-muted-foreground">{td.customer_name}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[td.status] || ""}`}>{td.status}</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone</span>
                    <span className="text-foreground">{td.phone_number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date</span>
                    <span className="text-foreground">{new Date(td.preferred_date).toLocaleDateString()}</span>
                  </div>
                  {td.preferred_time && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Time</span>
                      <span className="text-foreground">{td.preferred_time}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Source</span>
                    <SourceBadge source={td.booking_source || "manual"} />
                  </div>
                  {td.notes && (
                    <p className="text-xs text-muted-foreground mt-2 border-t pt-2">{td.notes}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Schedule Test Drive</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Customer Name *</Label>
                <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="Full name" />
              </div>
              <div className="space-y-2">
                <Label>Phone Number *</Label>
                <Input value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} placeholder="+91 98765 43210" />
              </div>
              <div className="space-y-2">
                <Label>Interested Model *</Label>
                <Input value={form.vehicle_model} onChange={(e) => setForm({ ...form, vehicle_model: e.target.value })} placeholder="e.g. 2024 Toyota Fortuner" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Preferred Date *</Label>
                  <Input type="date" value={form.preferred_date} onChange={(e) => setForm({ ...form, preferred_date: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Preferred Time</Label>
                  <Input type="time" value={form.preferred_time} onChange={(e) => setForm({ ...form, preferred_time: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>License Status</Label>
                  <Select value={form.license_status} onValueChange={(v) => setForm({ ...form, license_status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="verified">Verified</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Visit Type</Label>
                  <Select value={form.visit_type} onValueChange={(v) => setForm({ ...form, visit_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="showroom">Showroom</SelectItem>
                      <SelectItem value="home">Home Visit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Any additional notes" />
              </div>
              <Button className="w-full" onClick={handleCreate} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 animate-spin mr-1" />} Schedule Test Drive
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

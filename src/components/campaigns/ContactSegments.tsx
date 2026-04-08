import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Users, Loader2, Trash2, Upload } from "lucide-react";

export default function ContactSegments() {
  const { tenantId } = useAuth();
  const [segments, setSegments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", filter_type: "all" });
  const [saving, setSaving] = useState(false);
  const [csvData, setCsvData] = useState("");

  const fetchSegments = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase.from("contact_segments").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
    setSegments(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchSegments(); }, [tenantId]);

  const handleCreate = async () => {
    if (!tenantId || !form.name.trim()) { toast.error("Segment name required"); return; }
    setSaving(true);

    // Count customers matching filter
    let countQuery = supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const { count } = await countQuery;

    const { error } = await supabase.from("contact_segments").insert({
      tenant_id: tenantId,
      name: form.name.trim(),
      description: form.description,
      filter_criteria: { type: form.filter_type },
      customer_count: count || 0,
    } as any);
    setSaving(false);
    if (error) { toast.error("Failed to create segment"); return; }
    toast.success("Segment created");
    setShowCreate(false);
    setForm({ name: "", description: "", filter_type: "all" });
    fetchSegments();
  };

  const handleCsvUpload = async () => {
    if (!tenantId || !csvData.trim()) { toast.error("Paste CSV data"); return; }
    setSaving(true);
    const lines = csvData.trim().split("\n").slice(1); // skip header
    const contacts = lines.map((line) => {
      const [name, phone, email] = line.split(",").map((s) => s.trim());
      return { tenant_id: tenantId, name: name || "Unknown", phone: phone || null, email: email || null };
    }).filter((c) => c.name);

    if (contacts.length === 0) { toast.error("No valid contacts found"); setSaving(false); return; }

    const { error } = await supabase.from("customers").insert(contacts);
    setSaving(false);
    if (error) { toast.error("Upload failed: " + error.message); return; }
    toast.success(`${contacts.length} contacts uploaded`);
    setShowUpload(false);
    setCsvData("");
    fetchSegments();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("contact_segments").delete().eq("id", id);
    toast.success("Segment deleted");
    fetchSegments();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-foreground">Audience Segments</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowUpload(true)}>
            <Upload className="w-4 h-4" /> Upload Contacts
          </Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> New Segment
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : segments.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No segments yet. Create one to target specific audiences.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {segments.map((s: any) => (
            <div key={s.id} className="glass-card rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-medium text-foreground">{s.name}</h4>
                  {s.description && <p className="text-sm text-muted-foreground">{s.description}</p>}
                  <p className="text-lg font-bold text-primary mt-2">{s.customer_count} <span className="text-xs font-normal text-muted-foreground">contacts</span></p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(s.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Segment Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create Segment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Segment Name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. SUV Owners" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Customers who own SUVs" />
            </div>
            <div>
              <Label>Filter</Label>
              <Select value={form.filter_type} onValueChange={(v) => setForm({ ...form, filter_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  <SelectItem value="service_due">Service Due</SelectItem>
                  <SelectItem value="recent_leads">Recent Leads</SelectItem>
                  <SelectItem value="test_drive">Test Drive Completed</SelectItem>
                  <SelectItem value="inactive">Inactive (30+ days)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleCreate} disabled={saving} className="w-full">
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Create Segment
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Contacts Dialog */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent>
          <DialogHeader><DialogTitle>Upload Contacts (CSV)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Paste CSV with headers: <code className="bg-muted px-1 rounded">name,phone,email</code></p>
            <textarea
              className="w-full h-40 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              value={csvData}
              onChange={(e) => setCsvData(e.target.value)}
              placeholder={`name,phone,email\nAhmed Ali,+971501234567,ahmed@example.com\nSara Khan,+971502345678,sara@example.com`}
            />
            <Button onClick={handleCsvUpload} disabled={saving} className="w-full">
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Upload Contacts
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

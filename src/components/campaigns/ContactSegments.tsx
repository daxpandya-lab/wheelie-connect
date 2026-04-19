import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Users, Loader2, Trash2, Upload, FileText, Hash } from "lucide-react";

/**
 * Clean a phone number string:
 * - strip all non-digits
 * - drop leading 0
 * - if exactly 10 digits, prefix country code (default 91 / India)
 * - keep numbers that already include a country code (11–15 digits)
 * Returns null if the result isn't a plausible phone number.
 */
function cleanPhone(raw: string, defaultCc = "91"): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D+/g, "");
  digits = digits.replace(/^0+/, "");
  if (digits.length === 10) digits = defaultCc + digits;
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

interface ParsedContact {
  name: string;
  phone: string;
  email: string | null;
}

interface ParseResult {
  total: number;
  valid: ParsedContact[];
  invalid: number;
  duplicates: number;
}

function parseCsv(text: string): ParseResult {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return { total: 0, valid: [], invalid: 0, duplicates: 0 };
  // Skip header if it looks like one
  const first = lines[0].toLowerCase();
  const rows = /name|phone|mobile|email/.test(first) ? lines.slice(1) : lines;
  return parseRows(rows.map((line) => {
    const [name, phone, email] = line.split(",").map((s) => (s ?? "").trim());
    return { name, phone, email };
  }));
}

function parseManual(text: string): ParseResult {
  // Split on newlines, commas, semicolons
  const tokens = text.split(/[\n,;]+/).map((t) => t.trim()).filter(Boolean);
  return parseRows(tokens.map((t) => ({ name: "", phone: t, email: "" })));
}

function parseRows(rows: { name: string; phone: string; email: string }[]): ParseResult {
  const total = rows.length;
  const seen = new Set<string>();
  const valid: ParsedContact[] = [];
  let invalid = 0;
  let duplicates = 0;
  for (const r of rows) {
    const cleaned = cleanPhone(r.phone);
    if (!cleaned) { invalid++; continue; }
    if (seen.has(cleaned)) { duplicates++; continue; }
    seen.add(cleaned);
    valid.push({
      name: r.name?.trim() || `Contact ${cleaned.slice(-4)}`,
      phone: cleaned,
      email: r.email?.trim() || null,
    });
  }
  return { total, valid, invalid, duplicates };
}

export default function ContactSegments() {
  const { tenantId } = useAuth();
  const [segments, setSegments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", filter_type: "all" });
  const [saving, setSaving] = useState(false);
  const [uploadTab, setUploadTab] = useState<"csv" | "manual">("csv");
  const [csvData, setCsvData] = useState("");
  const [manualData, setManualData] = useState("");
  const [preview, setPreview] = useState<ParseResult | null>(null);

  const fetchSegments = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase.from("contact_segments").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
    setSegments(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchSegments(); }, [tenantId]);

  // Live preview as user types
  useEffect(() => {
    if (!showUpload) { setPreview(null); return; }
    const text = uploadTab === "csv" ? csvData : manualData;
    if (!text.trim()) { setPreview(null); return; }
    setPreview(uploadTab === "csv" ? parseCsv(text) : parseManual(text));
  }, [csvData, manualData, uploadTab, showUpload]);

  const handleCreate = async () => {
    if (!tenantId || !form.name.trim()) { toast.error("Segment name required"); return; }
    setSaving(true);
    const { count } = await supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
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

  const handleUpload = async () => {
    if (!tenantId) return;
    if (!preview || preview.valid.length === 0) {
      toast.error("No valid contacts to upload");
      return;
    }
    setSaving(true);

    // De-dupe against existing customers in the tenant
    const phones = preview.valid.map((c) => c.phone);
    const { data: existing } = await supabase
      .from("customers")
      .select("phone")
      .eq("tenant_id", tenantId)
      .in("phone", phones);
    const existingSet = new Set((existing || []).map((e: any) => e.phone));
    const fresh = preview.valid.filter((c) => !existingSet.has(c.phone));
    const dbDuplicates = preview.valid.length - fresh.length;

    if (fresh.length === 0) {
      setSaving(false);
      toast.info(`All ${preview.valid.length} contacts already exist`);
      return;
    }

    const { error } = await supabase.from("customers").insert(
      fresh.map((c) => ({ tenant_id: tenantId, name: c.name, phone: c.phone, email: c.email })),
    );
    setSaving(false);
    if (error) { toast.error("Upload failed: " + error.message); return; }
    toast.success(
      `${fresh.length} contacts added` +
        (dbDuplicates ? ` · ${dbDuplicates} already existed` : ""),
    );
    setShowUpload(false);
    setCsvData("");
    setManualData("");
    setPreview(null);
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
      <Dialog open={showUpload} onOpenChange={(o) => { setShowUpload(o); if (!o) { setCsvData(""); setManualData(""); setPreview(null); } }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Upload Contacts</DialogTitle></DialogHeader>
          <Tabs value={uploadTab} onValueChange={(v) => setUploadTab(v as "csv" | "manual")} className="space-y-4">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="csv"><FileText className="w-4 h-4 mr-1" /> Upload CSV</TabsTrigger>
              <TabsTrigger value="manual"><Hash className="w-4 h-4 mr-1" /> Manual Paste</TabsTrigger>
            </TabsList>

            <TabsContent value="csv" className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Paste CSV with headers: <code className="bg-muted px-1 rounded">name,phone,email</code>
              </p>
              <textarea
                className="w-full h-40 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                value={csvData}
                onChange={(e) => setCsvData(e.target.value)}
                placeholder={`name,phone,email\nAhmed Ali,9876543210,ahmed@example.com\nSara Khan,+91 98234 56789,sara@example.com`}
              />
            </TabsContent>

            <TabsContent value="manual" className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Paste or type phone numbers — one per line, or separated by commas/semicolons. Numbers are auto-cleaned and 10-digit numbers get a <code className="bg-muted px-1 rounded">91</code> prefix.
              </p>
              <textarea
                className="w-full h-40 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                value={manualData}
                onChange={(e) => setManualData(e.target.value)}
                placeholder={`9876543210\n+91 98234-56789\n91 87654 32109, 9123456780`}
              />
            </TabsContent>

            {preview && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-lg font-bold text-foreground">{preview.total}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Valid</p>
                  <p className="text-lg font-bold text-success">{preview.valid.length}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Removed</p>
                  <p className="text-lg font-bold text-destructive">{preview.invalid + preview.duplicates}</p>
                  <p className="text-[10px] text-muted-foreground">{preview.invalid} invalid · {preview.duplicates} dupes</p>
                </div>
              </div>
            )}

            <Button onClick={handleUpload} disabled={saving || !preview || preview.valid.length === 0} className="w-full">
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Upload {preview?.valid.length || 0} Contacts
            </Button>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}

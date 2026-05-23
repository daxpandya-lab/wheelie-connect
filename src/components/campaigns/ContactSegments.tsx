import { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Users, Loader2, Trash2, FileText, Hash, Upload, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Clean a phone number string:
 * - strip everything that isn't a digit (drops +, -, spaces, parens, …)
 * - drop leading 0s
 * - if exactly 10 digits, prefix the default country code (91 / India)
 * - accept numbers that already include a country code (11–15 digits)
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

interface Contact {
  id: string;       // local UI id
  name: string;
  phone: string;
  email: string | null;
}

/** Parse CSV text with optional header row: name,phone,email */
function parseCsvText(text: string): { name: string; phone: string; email: string | null }[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const first = lines[0].toLowerCase();
  const rows = /name|phone|mobile|email/.test(first) ? lines.slice(1) : lines;
  return rows.map((line) => {
    const parts = line.split(",").map((s) => (s ?? "").trim());
    const [name, phone, email] = parts;
    return { name: name || "", phone: phone || "", email: email || null };
  });
}

/**
 * Parse pasted free text — split on commas, semicolons, newlines, tabs,
 * AND spaces, then extract every contiguous run that contains 10+ digits.
 */
function parsePastedText(text: string): { name: string; phone: string; email: null }[] {
  if (!text.trim()) return [];
  const tokens = text.split(/[\s,;|]+/).map((t) => t.trim()).filter(Boolean);
  // Fallback: if nothing was tokenised (single big blob), regex-extract digit runs.
  const candidates = tokens.length
    ? tokens
    : (text.match(/[+\d][\d\s\-().]{8,}/g) || []);
  return candidates.map((t) => ({ name: "", phone: t, email: null }));
}

let LOCAL_ID = 0;
const nextId = () => `c_${++LOCAL_ID}_${Date.now()}`;

/**
 * Merge new rows into an existing contact list, de-duplicating by cleaned
 * phone number. Returns { merged, added, invalid, duplicates }.
 */
function mergeContacts(
  existing: Contact[],
  incoming: { name: string; phone: string; email: string | null }[],
): { merged: Contact[]; added: number; invalid: number; duplicates: number } {
  const seen = new Set(existing.map((c) => c.phone));
  const merged = [...existing];
  let added = 0;
  let invalid = 0;
  let duplicates = 0;
  for (const r of incoming) {
    const phone = cleanPhone(r.phone);
    if (!phone) { invalid++; continue; }
    if (seen.has(phone)) { duplicates++; continue; }
    seen.add(phone);
    merged.push({
      id: nextId(),
      name: r.name?.trim() || `Contact ${merged.length + 1}`,
      phone,
      email: r.email?.trim() || null,
    });
    added++;
  }
  return { merged, added, invalid, duplicates };
}

export default function ContactSegments() {
  const { tenantId } = useAuth();
  const [segments, setSegments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ name: "", description: "" });
  const [tab, setTab] = useState<"csv" | "manual">("manual");
  const [csvData, setCsvData] = useState("");
  const [pasteData, setPasteData] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const csvFileRef = useRef<HTMLInputElement>(null);

  const fetchSegments = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase
      .from("contact_segments")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    setSegments(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchSegments(); }, [tenantId]);

  const resetCreate = () => {
    setForm({ name: "", description: "" });
    setCsvData("");
    setPasteData("");
    setContacts([]);
    setTab("manual");
    setPage(1);
  };

  const ingestRows = (rows: { name: string; phone: string; email: string | null }[], label: string) => {
    const { merged, added, invalid, duplicates } = mergeContacts(contacts, rows);
    setContacts(merged);
    setPage(1);
    toast.success(
      `${label}: ${added} added` +
        (invalid ? ` · ${invalid} invalid` : "") +
        (duplicates ? ` · ${duplicates} duplicates` : ""),
    );
  };

  const addFromCsv = () => {
    if (!csvData.trim()) { toast.error("Paste CSV text first"); return; }
    ingestRows(parseCsvText(csvData), "CSV");
    setCsvData("");
  };

  const addFromPaste = () => {
    if (!pasteData.trim()) { toast.error("Paste contacts first"); return; }
    ingestRows(parsePastedText(pasteData), "Pasted");
    setPasteData("");
  };

  const handleCsvFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("CSV file too large (max 5MB)"); return; }
    try {
      const text = await file.text();
      ingestRows(parseCsvText(text), `CSV ${file.name}`);
    } catch (e: any) {
      toast.error("Could not read file: " + (e?.message || "unknown"));
    }
  };

  const removeContact = (id: string) =>
    setContacts((prev) => prev.filter((c) => c.id !== id));

  const totalSize = contacts.length;

  const handleSaveSegment = async () => {
    if (!tenantId) return;
    if (!form.name.trim()) { toast.error("Segment title is required"); return; }
    if (contacts.length === 0) { toast.error("Add at least one contact"); return; }

    setSaving(true);
    // 1. Create the segment scoped to this tenant
    const { data: seg, error: segErr } = await supabase
      .from("contact_segments")
      .insert({
        tenant_id: tenantId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        filter_criteria: { type: "manual_upload" },
        customer_count: contacts.length,
      } as any)
      .select("id")
      .single();

    if (segErr || !seg) {
      setSaving(false);
      toast.error("Failed to save segment: " + (segErr?.message || "unknown error"));
      return;
    }

    // 2. Write parsed rows into audience_contacts (tenant-isolated)
    const rows = contacts.map((c) => ({
      tenant_id: tenantId,
      segment_id: seg.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
    }));
    const { error: rowsErr } = await supabase.from("audience_contacts").insert(rows);
    setSaving(false);
    if (rowsErr) {
      toast.error("Saved segment but failed to save contacts: " + rowsErr.message);
      return;
    }

    toast.success(`Segment "${form.name.trim()}" saved with ${contacts.length} contacts`);
    resetCreate();
    setShowCreate(false);
    fetchSegments();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("contact_segments").delete().eq("id", id);
    toast.success("Segment deleted");
    fetchSegments();
  };

  const totalPages = Math.max(1, Math.ceil(contacts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const tableRows = useMemo(
    () => contacts.slice(pageStart, pageStart + PAGE_SIZE),
    [contacts, pageStart],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-foreground">Audience Segments</h3>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Segment
        </Button>
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
                  <p className="text-lg font-bold text-primary mt-2">
                    {s.customer_count} <span className="text-xs font-normal text-muted-foreground">contacts</span>
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(s.id)}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Segment Dialog (unified) */}
      <Dialog open={showCreate} onOpenChange={(o) => { setShowCreate(o); if (!o) resetCreate(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Segment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Segment Title</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. SUV Owners — May Campaign"
                  maxLength={120}
                />
              </div>
              <div>
                <Label>Description (optional)</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Short note for your team"
                  maxLength={300}
                />
              </div>
            </div>

            {/* Summary card */}
            <div className="rounded-lg border border-border bg-primary/5 px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Segment Audience Size</p>
                <p className="text-2xl font-bold text-primary">{totalSize} <span className="text-sm font-normal text-muted-foreground">Contacts</span></p>
              </div>
              {totalSize > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setContacts([])}>
                  Clear all
                </Button>
              )}
            </div>

            <Tabs value={tab} onValueChange={(v) => setTab(v as "csv" | "manual")} className="space-y-3">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="manual"><Hash className="w-4 h-4 mr-1" /> Copy / Paste</TabsTrigger>
                <TabsTrigger value="csv"><FileText className="w-4 h-4 mr-1" /> CSV</TabsTrigger>
              </TabsList>

              <TabsContent value="manual" className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Paste phone numbers separated by spaces, commas, semicolons, or newlines.
                  10-digit numbers automatically get the <code className="bg-muted px-1 rounded">91</code> prefix.
                </p>
                <textarea
                  className="w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  value={pasteData}
                  onChange={(e) => setPasteData(e.target.value)}
                  placeholder={`9876543210 +91 98234-56789, 91 87654 32109\n9123456780`}
                />
                <Button type="button" size="sm" onClick={addFromPaste} disabled={!pasteData.trim()}>
                  Add to Segment
                </Button>
              </TabsContent>

              <TabsContent value="csv" className="space-y-3">
                <div className="rounded-md border-2 border-dashed border-border bg-background p-4 flex flex-col items-center gap-2">
                  <Upload className="w-5 h-5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground text-center">
                    Upload a CSV file with headers <code className="bg-muted px-1 rounded">name,phone,email</code>
                  </p>
                  <input
                    ref={csvFileRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      handleCsvFile(e.target.files?.[0] ?? null);
                      if (csvFileRef.current) csvFileRef.current.value = "";
                    }}
                  />
                  <Button type="button" size="sm" variant="outline" onClick={() => csvFileRef.current?.click()}>
                    Choose CSV file
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">…or paste CSV text below:</p>
                <textarea
                  className="w-full h-24 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  value={csvData}
                  onChange={(e) => setCsvData(e.target.value)}
                  placeholder={`name,phone,email\nAhmed Ali,9876543210,ahmed@example.com\nSara Khan,+91 98234 56789,sara@example.com`}
                />
                <Button type="button" size="sm" onClick={addFromCsv} disabled={!csvData.trim()}>
                  Add to Segment
                </Button>
              </TabsContent>
            </Tabs>

            {/* Contacts preview grid (paginated) */}
            {contacts.length > 0 && (
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 w-16">Line No.</th>
                        <th className="px-3 py-2">Contact Name</th>
                        <th className="px-3 py-2">Phone (with 91)</th>
                        <th className="px-3 py-2 w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableRows.map((c, idx) => (
                        <tr key={c.id} className="border-t border-border/60 hover:bg-muted/30">
                          <td className="px-3 py-2 text-muted-foreground">{pageStart + idx + 1}</td>
                          <td className="px-3 py-2 text-foreground">{c.name}</td>
                          <td className="px-3 py-2 font-mono text-xs">{c.phone}</td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive"
                              onClick={() => removeContact(c.id)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-3 py-2 border-t border-border/60 bg-muted/20 text-xs text-muted-foreground">
                  <span>
                    Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, contacts.length)} of {contacts.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <span>Page {currentPage} / {totalPages}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            <Button
              onClick={handleSaveSegment}
              disabled={saving || !form.name.trim() || contacts.length === 0}
              className="w-full"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Save Segment ({totalSize} contacts)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

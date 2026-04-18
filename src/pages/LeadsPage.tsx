import { useState, useEffect, useRef } from "react";
import TopBar from "@/components/TopBar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Upload, Loader2, Settings2, LayoutGrid, List as ListIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useDynamicColumns } from "@/hooks/useDynamicColumns";
import ColumnManagerDialog from "@/components/reports/ColumnManagerDialog";
import DynamicReportTable from "@/components/reports/DynamicReportTable";

type Lead = {
  id: string;
  customer_name: string;
  phone_number: string | null;
  email: string | null;
  vehicle_interest: string | null;
  source: string;
  status: string;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

const FIXED_COLS = [
  { key: "customer_name", label: "Customer" },
  { key: "phone_number", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "vehicle_interest", label: "Vehicle Interest" },
  { key: "source", label: "Source" },
  { key: "status", label: "Status" },
  { key: "created_at", label: "Created" },
];

const stages = [
  { name: "New", value: "new", color: "bg-info" },
  { name: "Contacted", value: "contacted", color: "bg-primary" },
  { name: "Qualified", value: "qualified", color: "bg-warning" },
  { name: "Proposal", value: "proposal", color: "bg-accent" },
  { name: "Won", value: "won", color: "bg-success" },
];

export default function LeadsPage() {
  const { tenantId } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"kanban" | "table">("table");
  const [colMgrOpen, setColMgrOpen] = useState(false);

  const { columns, savePrefs } = useDynamicColumns("leads", FIXED_COLS, leads);

  const fetchLeads = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase
      .from("leads")
      .select("id, customer_name, phone_number, email, vehicle_interest, source, status, created_at, metadata")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (data) setLeads(data as unknown as Lead[]);
    setLoading(false);
  };

  useEffect(() => { fetchLeads(); }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase.channel("leads_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `tenant_id=eq.${tenantId}` }, () => fetchLeads())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId]);

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId) return;
    setUploading(true);
    try {
      const text = await file.text();
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) { toast.error("File must have a header row and at least one data row"); setUploading(false); return; }
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const nameIdx = headers.findIndex((h) => h.includes("name"));
      const phoneIdx = headers.findIndex((h) => h.includes("phone"));
      const emailIdx = headers.findIndex((h) => h.includes("email"));
      const vehicleIdx = headers.findIndex((h) => h.includes("vehicle") || h.includes("model") || h.includes("interest"));
      const sourceIdx = headers.findIndex((h) => h.includes("source"));
      if (nameIdx === -1) { toast.error("CSV must have a 'name' column"); setUploading(false); return; }
      const rows = lines.slice(1).map((line) => {
        const cols = line.split(",").map((c) => c.trim());
        return {
          tenant_id: tenantId,
          customer_name: cols[nameIdx] || "Unknown",
          phone_number: phoneIdx >= 0 ? cols[phoneIdx] || null : null,
          email: emailIdx >= 0 ? cols[emailIdx] || null : null,
          vehicle_interest: vehicleIdx >= 0 ? cols[vehicleIdx] || null : null,
          source: (sourceIdx >= 0 && ["whatsapp", "web", "walkin", "referral", "campaign"].includes(cols[sourceIdx]?.toLowerCase()))
            ? (cols[sourceIdx].toLowerCase() as any) : ("web" as any),
          status: "new" as const,
        };
      }).filter((r) => r.customer_name !== "Unknown");
      if (rows.length === 0) { toast.error("No valid rows found"); setUploading(false); return; }
      const { error } = await supabase.from("leads").insert(rows);
      if (error) toast.error(error.message);
      else { toast.success(`${rows.length} leads imported successfully`); fetchLeads(); }
    } catch (err: any) {
      toast.error("Failed to parse file: " + err.message);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
      <TopBar title="Lead Pipeline" />
      <div className="flex-1 overflow-auto p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <Tabs value={view} onValueChange={(v) => setView(v as any)}>
            <TabsList className="h-9">
              <TabsTrigger value="table" className="text-xs gap-1"><ListIcon className="w-3.5 h-3.5" />Report</TabsTrigger>
              <TabsTrigger value="kanban" className="text-xs gap-1"><LayoutGrid className="w-3.5 h-3.5" />Pipeline</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => setColMgrOpen(true)} className="gap-1.5">
            <Settings2 className="w-4 h-4" /> Manage Columns
          </Button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleBulkUpload} />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
            Bulk Upload
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : view === "table" ? (
          <DynamicReportTable
            columns={columns}
            rows={leads}
            emptyMessage="No leads yet. They'll appear here as your chatbot collects them."
          />
        ) : (
          <div className="flex gap-4 min-w-max overflow-x-auto pb-2">
            {stages.map((stage) => {
              const stageLeads = leads.filter((l) => l.status === stage.value);
              return (
                <div key={stage.value} className="w-72 flex flex-col">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={cn("w-3 h-3 rounded-full", stage.color)} />
                    <h3 className="text-sm font-semibold text-foreground">{stage.name}</h3>
                    <span className="text-xs text-muted-foreground bg-secondary rounded-full px-2 py-0.5">
                      {stageLeads.length}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {stageLeads.map((lead) => (
                      <div key={lead.id} className="glass-card rounded-xl p-4 hover:shadow-md transition-shadow">
                        <p className="font-medium text-foreground text-sm">{lead.customer_name}</p>
                        <p className="text-xs text-muted-foreground mb-1">{lead.vehicle_interest || "—"}</p>
                        <p className="text-xs text-muted-foreground font-mono">{lead.phone_number}</p>
                        <p className="text-[10px] text-muted-foreground mt-2 capitalize">{lead.source}</p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ColumnManagerDialog
        open={colMgrOpen}
        onOpenChange={setColMgrOpen}
        columns={columns}
        onSave={async (next) => savePrefs(next)}
      />
    </>
  );
}

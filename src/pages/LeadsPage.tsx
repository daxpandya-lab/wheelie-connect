import { useState, useRef } from "react";
import TopBar from "@/components/TopBar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Upload, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const stages = [
  { name: "New", color: "bg-info", leads: [
    { name: "Khalid Nasser", source: "WhatsApp", vehicle: "2024 Toyota Land Cruiser", value: "$85,000", time: "2h ago" },
    { name: "Layla Ahmed", source: "Website", vehicle: "2024 BMW X3", value: "$62,000", time: "5h ago" },
  ]},
  { name: "Contacted", color: "bg-primary", leads: [
    { name: "Rashed Omar", source: "Walk-in", vehicle: "2024 Mercedes GLE", value: "$78,000", time: "1d ago" },
  ]},
  { name: "Test Drive", color: "bg-warning", leads: [
    { name: "Nadia Saleh", source: "WhatsApp", vehicle: "2024 Audi Q7", value: "$72,000", time: "2d ago" },
    { name: "Hassan Ibrahim", source: "Referral", vehicle: "2024 Lexus RX", value: "$58,000", time: "3d ago" },
  ]},
  { name: "Negotiation", color: "bg-accent", leads: [
    { name: "Youssef Mansour", source: "WhatsApp", vehicle: "2024 Range Rover", value: "$120,000", time: "4d ago" },
  ]},
  { name: "Won", color: "bg-success", leads: [
    { name: "Amira Karim", source: "Website", vehicle: "2024 Porsche Cayenne", value: "$95,000", time: "1w ago" },
  ]},
];

const sourceStyle: Record<string, string> = {
  WhatsApp: "bg-success/10 text-success",
  Website: "bg-primary/10 text-primary",
  "Walk-in": "bg-warning/10 text-warning",
  Referral: "bg-accent/10 text-accent",
};

export default function LeadsPage() {
  const { tenantId } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId) return;

    setUploading(true);
    try {
      const text = await file.text();
      const lines = text.split("\n").filter(l => l.trim());
      if (lines.length < 2) { toast.error("File must have a header row and at least one data row"); setUploading(false); return; }

      const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
      const nameIdx = headers.findIndex(h => h.includes("name"));
      const phoneIdx = headers.findIndex(h => h.includes("phone"));
      const emailIdx = headers.findIndex(h => h.includes("email"));
      const vehicleIdx = headers.findIndex(h => h.includes("vehicle") || h.includes("model") || h.includes("interest"));
      const sourceIdx = headers.findIndex(h => h.includes("source"));

      if (nameIdx === -1) { toast.error("CSV must have a 'name' column"); setUploading(false); return; }

      const rows = lines.slice(1).map(line => {
        const cols = line.split(",").map(c => c.trim());
        return {
          tenant_id: tenantId,
          customer_name: cols[nameIdx] || "Unknown",
          phone_number: phoneIdx >= 0 ? cols[phoneIdx] || null : null,
          email: emailIdx >= 0 ? cols[emailIdx] || null : null,
          vehicle_interest: vehicleIdx >= 0 ? cols[vehicleIdx] || null : null,
          source: (sourceIdx >= 0 && ["whatsapp", "web", "walkin", "referral", "campaign"].includes(cols[sourceIdx]?.toLowerCase()))
            ? cols[sourceIdx].toLowerCase() as any : "web" as any,
          status: "new" as const,
        };
      }).filter(r => r.customer_name !== "Unknown");

      if (rows.length === 0) { toast.error("No valid rows found"); setUploading(false); return; }

      const { error } = await supabase.from("leads").insert(rows);
      if (error) toast.error(error.message);
      else toast.success(`${rows.length} leads imported successfully`);
    } catch (err: any) {
      toast.error("Failed to parse file: " + err.message);
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <>
      <TopBar title="Lead Pipeline" />
      <div className="flex-1 overflow-x-auto p-6">
        <div className="flex justify-end mb-4">
          <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleBulkUpload} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
            Bulk Upload
          </Button>
        </div>
        <div className="flex gap-4 min-w-max">
          {stages.map((stage) => (
            <div key={stage.name} className="w-72 flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <div className={cn("w-3 h-3 rounded-full", stage.color)} />
                <h3 className="text-sm font-semibold text-foreground">{stage.name}</h3>
                <span className="text-xs text-muted-foreground bg-secondary rounded-full px-2 py-0.5">{stage.leads.length}</span>
              </div>
              <div className="space-y-3">
                {stage.leads.map((lead, i) => (
                  <div key={i} className="glass-card rounded-xl p-4 cursor-pointer hover:shadow-md transition-shadow">
                    <div className="flex items-start justify-between mb-2">
                      <p className="font-medium text-foreground text-sm">{lead.name}</p>
                      <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", sourceStyle[lead.source])}>
                        {lead.source}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-1">{lead.vehicle}</p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-sm font-semibold text-foreground">{lead.value}</span>
                      <span className="text-xs text-muted-foreground">{lead.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

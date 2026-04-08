import TopBar from "@/components/TopBar";
import { cn } from "@/lib/utils";

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
  return (
    <>
      <TopBar title="Lead Pipeline" />
      <div className="flex-1 overflow-x-auto p-6">
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

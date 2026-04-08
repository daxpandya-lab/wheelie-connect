import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Plus, Send, BarChart3, MoreHorizontal } from "lucide-react";

const campaigns = [
  { id: 1, name: "Service Reminder - April", template: "service_reminder_v2", audience: "Due for Service", recipients: 342, sent: 342, delivered: 328, read: 201, status: "Completed", date: "Apr 1, 2026" },
  { id: 2, name: "Ramadan Special Offers", template: "ramadan_promo_2026", audience: "All Active Customers", recipients: 1200, sent: 1200, delivered: 1156, read: 734, status: "Completed", date: "Mar 25, 2026" },
  { id: 3, name: "New Model Launch - LC300", template: "new_model_launch", audience: "SUV Enthusiasts", recipients: 560, sent: 0, delivered: 0, read: 0, status: "Scheduled", date: "Apr 10, 2026" },
  { id: 4, name: "Test Drive Follow-up", template: "test_drive_followup", audience: "Recent Test Drives", recipients: 45, sent: 45, delivered: 43, read: 38, status: "Completed", date: "Apr 5, 2026" },
];

const statusColors: Record<string, string> = {
  Completed: "bg-success/10 text-success",
  Scheduled: "bg-primary/10 text-primary",
  Draft: "bg-muted text-muted-foreground",
  Sending: "bg-info/10 text-info",
};

export default function CampaignsPage() {
  return (
    <>
      <TopBar title="Campaigns" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex justify-end">
          <Button><Plus className="w-4 h-4" /> New Campaign</Button>
        </div>
        <div className="space-y-4">
          {campaigns.map((c) => (
            <div key={c.id} className="glass-card rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-foreground">{c.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1">Template: {c.template} · Audience: {c.audience}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[c.status]}`}>{c.status}</span>
                  <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="w-4 h-4" /></Button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">{c.recipients.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Recipients</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">{c.delivered.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Delivered</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-foreground">{c.read.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Read</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-primary">{c.delivered > 0 ? Math.round((c.read / c.delivered) * 100) : 0}%</p>
                  <p className="text-xs text-muted-foreground">Read Rate</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">{c.date}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

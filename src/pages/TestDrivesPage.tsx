import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Plus, Car } from "lucide-react";

const testDrives = [
  { id: "TD-01", customer: "Nadia Saleh", vehicle: "2024 Audi Q7", date: "Apr 8, 2026", time: "10:00 AM", license: true, status: "Confirmed", feedback: null },
  { id: "TD-02", customer: "Hassan Ibrahim", vehicle: "2024 Lexus RX", date: "Apr 8, 2026", time: "2:00 PM", license: true, status: "In Progress", feedback: null },
  { id: "TD-03", customer: "Amira Karim", vehicle: "2024 Porsche Cayenne", date: "Apr 7, 2026", time: "11:00 AM", license: true, status: "Completed", feedback: 4.8 },
  { id: "TD-04", customer: "Khalid Nasser", vehicle: "2024 Toyota Land Cruiser", date: "Apr 9, 2026", time: "9:30 AM", license: false, status: "Pending Verification", feedback: null },
];

const statusColors: Record<string, string> = {
  "Confirmed": "bg-primary/10 text-primary",
  "In Progress": "bg-info/10 text-info",
  "Completed": "bg-success/10 text-success",
  "Pending Verification": "bg-warning/10 text-warning",
};

export default function TestDrivesPage() {
  return (
    <>
      <TopBar title="Test Drives" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex justify-end">
          <Button><Plus className="w-4 h-4" /> Schedule Test Drive</Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {testDrives.map((td) => (
            <div key={td.id} className="glass-card rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Car className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{td.vehicle}</p>
                    <p className="text-xs text-muted-foreground">{td.id}</p>
                  </div>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[td.status]}`}>{td.status}</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="text-foreground font-medium">{td.customer}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date & Time</span>
                  <span className="text-foreground">{td.date}, {td.time}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">License</span>
                  <span className={td.license ? "text-success" : "text-warning"}>{td.license ? "Verified" : "Pending"}</span>
                </div>
                {td.feedback && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Feedback</span>
                    <span className="text-foreground font-medium">⭐ {td.feedback}/5</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

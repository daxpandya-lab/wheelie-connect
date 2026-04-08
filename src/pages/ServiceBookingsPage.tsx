import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Plus, Calendar } from "lucide-react";

const bookings = [
  { id: "SB-101", customer: "Ahmed Al-Farsi", vehicle: "2023 Toyota Camry", service: "Full Service", bay: "Bay 1", date: "Apr 8, 2026", time: "09:00", status: "In Progress", tech: "Ali M." },
  { id: "SB-102", customer: "Sara Khan", vehicle: "2022 Honda Civic", service: "Oil Change", bay: "Bay 2", date: "Apr 8, 2026", time: "10:30", status: "Completed", tech: "Hassan R." },
  { id: "SB-103", customer: "Mohammed Ali", vehicle: "2024 BMW X5", service: "Brake Inspection", bay: "Bay 1", date: "Apr 8, 2026", time: "14:00", status: "Scheduled", tech: "Ali M." },
  { id: "SB-104", customer: "Fatima Hassan", vehicle: "2023 Mercedes C200", service: "Tire Rotation", bay: "Bay 3", date: "Apr 9, 2026", time: "09:30", status: "Scheduled", tech: "Omar K." },
  { id: "SB-105", customer: "Omar Khalid", vehicle: "2024 Lexus IS", service: "AC Repair", bay: "Bay 2", date: "Apr 9, 2026", time: "11:00", status: "Pending", tech: "Hassan R." },
];

const statusColors: Record<string, string> = {
  "In Progress": "bg-info/10 text-info",
  "Completed": "bg-success/10 text-success",
  "Scheduled": "bg-primary/10 text-primary",
  "Pending": "bg-warning/10 text-warning",
};

export default function ServiceBookingsPage() {
  return (
    <>
      <TopBar title="Service Bookings" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm"><Calendar className="w-4 h-4 mr-1" /> Today</Button>
            <Button variant="ghost" size="sm">This Week</Button>
            <Button variant="ghost" size="sm">All</Button>
          </div>
          <Button><Plus className="w-4 h-4" /> New Booking</Button>
        </div>

        <div className="glass-card rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">ID</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Customer</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden lg:table-cell">Vehicle</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Service</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden md:table-cell">Bay</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden md:table-cell">Date & Time</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-b border-border/50 last:border-0 hover:bg-secondary/30 transition-colors">
                  <td className="py-3 px-4 font-medium text-foreground">{b.id}</td>
                  <td className="py-3 px-4 text-foreground">{b.customer}</td>
                  <td className="py-3 px-4 text-muted-foreground hidden lg:table-cell">{b.vehicle}</td>
                  <td className="py-3 px-4 text-foreground">{b.service}</td>
                  <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{b.bay}</td>
                  <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{b.date} {b.time}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[b.status]}`}>{b.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Search, Plus, Phone, Mail, MoreHorizontal } from "lucide-react";

const customers = [
  { id: 1, name: "Ahmed Al-Farsi", email: "ahmed@example.com", phone: "+971 50 123 4567", vehicles: 2, lastVisit: "Apr 2, 2026", status: "Active" },
  { id: 2, name: "Sara Khan", email: "sara@example.com", phone: "+971 55 987 6543", vehicles: 1, lastVisit: "Mar 28, 2026", status: "Active" },
  { id: 3, name: "Mohammed Ali", email: "mohammed@example.com", phone: "+971 52 456 7890", vehicles: 3, lastVisit: "Mar 15, 2026", status: "VIP" },
  { id: 4, name: "Fatima Hassan", email: "fatima@example.com", phone: "+971 56 321 0987", vehicles: 1, lastVisit: "Feb 20, 2026", status: "Inactive" },
  { id: 5, name: "Omar Khalid", email: "omar@example.com", phone: "+971 58 654 3210", vehicles: 2, lastVisit: "Apr 5, 2026", status: "Active" },
];

const statusStyle: Record<string, string> = {
  Active: "bg-success/10 text-success",
  VIP: "bg-primary/10 text-primary",
  Inactive: "bg-muted text-muted-foreground",
};

export default function CustomersPage() {
  return (
    <>
      <TopBar title="Customers" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search customers..."
              className="h-9 w-72 rounded-lg border border-input bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <Button>
            <Plus className="w-4 h-4" /> Add Customer
          </Button>
        </div>

        <div className="glass-card rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Customer</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden md:table-cell">Contact</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Vehicles</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden lg:table-cell">Last Visit</th>
                <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-b border-border/50 last:border-0 hover:bg-secondary/30 transition-colors">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
                        {c.name.split(" ").map(n => n[0]).join("")}
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{c.name}</p>
                        <p className="text-xs text-muted-foreground md:hidden">{c.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 hidden md:table-cell">
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-muted-foreground"><Mail className="w-3 h-3" /> {c.email}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-foreground">{c.vehicles}</td>
                  <td className="py-3 px-4 text-muted-foreground hidden lg:table-cell">{c.lastVisit}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusStyle[c.status]}`}>{c.status}</span>
                  </td>
                  <td className="py-3 px-4">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                    </Button>
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

import TopBar from "@/components/TopBar";
import KpiCard from "@/components/KpiCard";
import { Users, Wrench, Car, MessageSquare, TrendingUp, DollarSign, Clock, CheckCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts";

const bookingData = [
  { day: "Mon", bookings: 12 }, { day: "Tue", bookings: 19 },
  { day: "Wed", bookings: 15 }, { day: "Thu", bookings: 22 },
  { day: "Fri", bookings: 28 }, { day: "Sat", bookings: 18 },
  { day: "Sun", bookings: 8 },
];

const revenueData = [
  { month: "Jan", revenue: 42000 }, { month: "Feb", revenue: 48000 },
  { month: "Mar", revenue: 55000 }, { month: "Apr", revenue: 51000 },
  { month: "May", revenue: 63000 }, { month: "Jun", revenue: 71000 },
];

const recentBookings = [
  { id: "SB-001", customer: "Ahmed Al-Farsi", vehicle: "2023 Toyota Camry", service: "Full Service", status: "In Progress", time: "10:00 AM" },
  { id: "SB-002", customer: "Sara Khan", vehicle: "2022 Honda Civic", service: "Oil Change", status: "Completed", time: "11:30 AM" },
  { id: "SB-003", customer: "Mohammed Ali", vehicle: "2024 BMW X5", service: "Brake Inspection", status: "Pending", time: "2:00 PM" },
  { id: "SB-004", customer: "Fatima Hassan", vehicle: "2023 Mercedes C200", service: "Tire Rotation", status: "Scheduled", time: "3:30 PM" },
];

const statusColors: Record<string, string> = {
  "In Progress": "bg-info/10 text-info",
  "Completed": "bg-success/10 text-success",
  "Pending": "bg-warning/10 text-warning",
  "Scheduled": "bg-primary/10 text-primary",
};

export default function DashboardPage() {
  return (
    <>
      <TopBar title="Dashboard" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Customers" value="2,847" change="+12.5% from last month" changeType="positive" icon={Users} delay={0} />
          <KpiCard title="Service Bookings" value="156" change="+8.2% from last week" changeType="positive" icon={Wrench} delay={100} />
          <KpiCard title="Test Drives" value="34" change="-3.1% from last week" changeType="negative" icon={Car} delay={200} />
          <KpiCard title="Active Conversations" value="89" change="12 unread messages" changeType="neutral" icon={MessageSquare} delay={300} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card rounded-xl p-5 opacity-0 animate-fade-in" style={{ animationDelay: "400ms" }}>
            <h3 className="text-sm font-semibold text-foreground mb-4">Weekly Bookings</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={bookingData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="bookings" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card rounded-xl p-5 opacity-0 animate-fade-in" style={{ animationDelay: "500ms" }}>
            <h3 className="text-sm font-semibold text-foreground mb-4">Revenue Trend</h3>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `$${v / 1000}k`} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [`$${v.toLocaleString()}`, "Revenue"]} />
                <Line type="monotone" dataKey="revenue" stroke="hsl(var(--accent))" strokeWidth={2.5} dot={{ fill: "hsl(var(--accent))", r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 glass-card rounded-xl p-5 opacity-0 animate-fade-in" style={{ animationDelay: "600ms" }}>
            <h3 className="text-sm font-semibold text-foreground mb-4">Recent Bookings</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-muted-foreground font-medium">ID</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Customer</th>
                    <th className="text-left py-2 text-muted-foreground font-medium hidden md:table-cell">Vehicle</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Service</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBookings.map((b) => (
                    <tr key={b.id} className="border-b border-border/50 last:border-0">
                      <td className="py-3 text-foreground font-medium">{b.id}</td>
                      <td className="py-3 text-foreground">{b.customer}</td>
                      <td className="py-3 text-muted-foreground hidden md:table-cell">{b.vehicle}</td>
                      <td className="py-3 text-foreground">{b.service}</td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[b.status]}`}>
                          {b.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="glass-card rounded-xl p-5 opacity-0 animate-fade-in" style={{ animationDelay: "700ms" }}>
            <h3 className="text-sm font-semibold text-foreground mb-4">Quick Stats</h3>
            <div className="space-y-4">
              {[
                { icon: TrendingUp, label: "Conversion Rate", value: "24.8%", color: "text-success" },
                { icon: DollarSign, label: "Avg. Service Value", value: "$285", color: "text-primary" },
                { icon: Clock, label: "Avg. Response Time", value: "2.4 min", color: "text-warning" },
                { icon: CheckCircle, label: "CSAT Score", value: "4.7/5", color: "text-accent" },
              ].map((stat) => (
                <div key={stat.label} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
                    <stat.icon className={`w-4 h-4 ${stat.color}`} />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                    <p className="text-sm font-semibold text-foreground">{stat.value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

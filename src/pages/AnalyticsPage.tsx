import TopBar from "@/components/TopBar";
import KpiCard from "@/components/KpiCard";
import { TrendingUp, Users, Wrench, MessageSquare, DollarSign, Clock, Car, Target } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const serviceData = [
  { name: "Full Service", count: 45 }, { name: "Oil Change", count: 62 },
  { name: "Brake", count: 28 }, { name: "Tire", count: 35 },
  { name: "AC Repair", count: 18 }, { name: "Other", count: 22 },
];

const leadSourceData = [
  { name: "WhatsApp", value: 45, color: "hsl(var(--success))" },
  { name: "Website", value: 25, color: "hsl(var(--primary))" },
  { name: "Walk-in", value: 18, color: "hsl(var(--warning))" },
  { name: "Referral", value: 12, color: "hsl(var(--accent))" },
];

export default function AnalyticsPage() {
  return (
    <>
      <TopBar title="Analytics" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Revenue (MTD)" value="$71,240" change="+18.3% vs last month" changeType="positive" icon={DollarSign} />
          <KpiCard title="Lead Conversion" value="24.8%" change="+2.1% vs last month" changeType="positive" icon={Target} delay={100} />
          <KpiCard title="Avg. Response Time" value="2.4 min" change="-0.8 min improvement" changeType="positive" icon={Clock} delay={200} />
          <KpiCard title="Bay Utilization" value="78%" change="+5% vs last week" changeType="positive" icon={Wrench} delay={300} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card rounded-xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Service Types Distribution</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={serviceData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} width={80} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card rounded-xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Lead Sources</h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={leadSourceData} cx="50%" cy="50%" outerRadius={100} innerRadius={60} dataKey="value" paddingAngle={4}>
                  {leadSourceData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-2">
              {leadSourceData.map((d) => (
                <div key={d.name} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-xs text-muted-foreground">{d.name} ({d.value}%)</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

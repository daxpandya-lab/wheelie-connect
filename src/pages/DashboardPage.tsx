import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import KpiCard from "@/components/KpiCard";
import { Users, Wrench, Car, MessageSquare, TrendingUp, Clock, CheckCircle, Target, AlertTriangle, Wifi, WifiOff } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, isToday } from "date-fns";

type GatewayStatus = {
  provider: "meta" | "evolution";
  connected: boolean;
  detail: string;
};

export default function DashboardPage() {
  const { tenantId } = useAuth();
  const [kpis, setKpis] = useState({ customers: 0, bookings: 0, todayBookings: 0, testDrives: 0, activeConvos: 0, leads: 0, completedBookings: 0, conversionRate: 0 });
  const [weeklyBookings, setWeeklyBookings] = useState<{ day: string; bookings: number }[]>([]);
  const [recentBookings, setRecentBookings] = useState<any[]>([]);
  const [maxPerDay, setMaxPerDay] = useState<number | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);

  const fetchDashboard = useCallback(async () => {
    if (!tenantId) return;

    const [customersRes, bookingsRes, testDrivesRes, convosRes, leadsRes, tenantRes] = await Promise.all([
      supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      supabase.from("service_bookings").select("id, customer_name, phone_number, vehicle_model, service_type, booking_date, status").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      supabase.from("test_drive_bookings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      supabase.from("chatbot_conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "active"),
      supabase.from("leads").select("id, status").eq("tenant_id", tenantId),
      supabase.from("tenants").select("settings").eq("id", tenantId).single(),
    ]);

    const settings = tenantRes.data?.settings as Record<string, unknown> | null;
    if (settings?.max_vehicles_per_day) setMaxPerDay(Number(settings.max_vehicles_per_day));

    const bookings = bookingsRes.data || [];
    const leads = leadsRes.data || [];
    const todayCount = bookings.filter((b) => isToday(new Date(b.booking_date))).length;
    const completedCount = bookings.filter((b) => b.status === "completed").length;
    const wonLeads = leads.filter((l) => l.status === "won").length;

    setKpis({
      customers: customersRes.count || 0,
      bookings: bookings.length,
      todayBookings: todayCount,
      testDrives: testDrivesRes.count || 0,
      activeConvos: convosRes.count || 0,
      leads: leads.length,
      completedBookings: completedCount,
      conversionRate: leads.length > 0 ? Math.round((wonLeads / leads.length) * 100 * 10) / 10 : 0,
    });

    // Weekly bookings chart
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayMap: Record<string, number> = {};
    days.forEach((d) => (dayMap[d] = 0));
    bookings.forEach((b) => {
      const d = days[new Date(b.booking_date).getDay()];
      dayMap[d]++;
    });
    setWeeklyBookings(days.map((d) => ({ day: d, bookings: dayMap[d] })));

    // Recent bookings
    setRecentBookings(bookings.slice(0, 5));
  }, [tenantId]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // Real-time
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase.channel("dashboard_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "service_bookings", filter: `tenant_id=eq.${tenantId}` }, () => fetchDashboard())
      .on("postgres_changes", { event: "*", schema: "public", table: "chatbot_conversations", filter: `tenant_id=eq.${tenantId}` }, () => fetchDashboard())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId, fetchDashboard]);

  const statusColors: Record<string, string> = {
    pending: "bg-warning/10 text-warning",
    confirmed: "bg-info/10 text-info",
    in_progress: "bg-primary/10 text-primary",
    completed: "bg-success/10 text-success",
    cancelled: "bg-destructive/10 text-destructive",
  };

  const capacityPercent = maxPerDay ? Math.round((kpis.todayBookings / maxPerDay) * 100) : null;
  const isAlmostFull = capacityPercent !== null && capacityPercent >= 80;
  const isFull = capacityPercent !== null && capacityPercent >= 100;

  return (
    <>
      <TopBar title="Dashboard" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Capacity Alert */}
        {maxPerDay && (
          <div className={`rounded-xl p-4 flex items-center gap-3 border ${
            isFull ? "bg-destructive/10 border-destructive/30" :
            isAlmostFull ? "bg-warning/10 border-warning/30" :
            "bg-success/10 border-success/30"
          }`}>
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              isFull ? "bg-destructive/20" : isAlmostFull ? "bg-warning/20" : "bg-success/20"
            }`}>
              {isFull || isAlmostFull ? (
                <AlertTriangle className={`w-5 h-5 ${isFull ? "text-destructive" : "text-warning"}`} />
              ) : (
                <Car className="w-5 h-5 text-success" />
              )}
            </div>
            <div className="flex-1">
              <p className={`text-sm font-semibold ${
                isFull ? "text-destructive" : isAlmostFull ? "text-warning" : "text-success"
              }`}>
                Today's Capacity: {kpis.todayBookings} / {maxPerDay} vehicles booked
              </p>
              <p className="text-xs text-muted-foreground">
                {isFull ? "Fully booked for today! No more slots available." :
                 isAlmostFull ? "Almost full for today — only a few slots remaining." :
                 "Slots available for today."}
              </p>
            </div>
            {/* Progress bar */}
            <div className="w-24 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  isFull ? "bg-destructive" : isAlmostFull ? "bg-warning" : "bg-success"
                }`}
                style={{ width: `${Math.min(capacityPercent || 0, 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Customers" value={kpis.customers.toLocaleString()} icon={Users} delay={0} />
          <KpiCard
            title="Service Bookings"
            value={kpis.bookings.toLocaleString()}
            change={maxPerDay ? `${kpis.todayBookings}/${maxPerDay} today` : `${kpis.todayBookings} today`}
            changeType="neutral"
            icon={Wrench}
            delay={100}
          />
          <KpiCard title="Test Drives" value={kpis.testDrives.toLocaleString()} icon={Car} delay={200} />
          <KpiCard title="Active Conversations" value={kpis.activeConvos.toLocaleString()} icon={MessageSquare} delay={300} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card rounded-xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Bookings by Day</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={weeklyBookings}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="bookings" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="glass-card rounded-xl p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">Quick Stats</h3>
            <div className="space-y-4">
              {[
                { icon: TrendingUp, label: "Conversion Rate", value: `${kpis.conversionRate}%`, color: "text-success" },
                { icon: Target, label: "Total Leads", value: kpis.leads.toLocaleString(), color: "text-primary" },
                { icon: Clock, label: "Today's Bookings", value: maxPerDay ? `${kpis.todayBookings} / ${maxPerDay}` : kpis.todayBookings.toLocaleString(), color: "text-warning" },
                { icon: CheckCircle, label: "Completed", value: kpis.completedBookings.toLocaleString(), color: "text-accent" },
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

        {/* Recent Bookings */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4">Recent Bookings</h3>
          {recentBookings.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">No bookings yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-muted-foreground font-medium">Customer</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Phone</th>
                    <th className="text-left py-2 text-muted-foreground font-medium hidden md:table-cell">Vehicle</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Service</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Date</th>
                    <th className="text-left py-2 text-muted-foreground font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBookings.map((b) => (
                    <tr key={b.id} className="border-b border-border/50 last:border-0">
                      <td className="py-3 text-foreground font-medium">{b.customer_name}</td>
                      <td className="py-3 text-muted-foreground font-mono text-xs">{b.phone_number}</td>
                      <td className="py-3 text-muted-foreground hidden md:table-cell">{b.vehicle_model}</td>
                      <td className="py-3 text-foreground capitalize">{b.service_type?.replace("_", " ")}</td>
                      <td className="py-3 text-foreground">{format(new Date(b.booking_date), "MMM d")}</td>
                      <td className="py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[b.status] || ""}`}>
                          {b.status?.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

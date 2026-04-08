import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import KpiCard from "@/components/KpiCard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Users, Wrench, Car, MessageSquare, TrendingUp, Target, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { format, subDays } from "date-fns";

const COLORS = ["hsl(217, 91%, 50%)", "hsl(152, 69%, 41%)", "hsl(38, 92%, 50%)", "hsl(0, 84%, 60%)", "hsl(168, 72%, 42%)", "hsl(199, 89%, 48%)"];

export default function AnalyticsPage() {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState({ customers: 0, bookings: 0, testDrives: 0, conversations: 0, leads: 0, campaigns: 0 });
  const [bookingsByStatus, setBookingsByStatus] = useState<{ name: string; value: number }[]>([]);
  const [bookingsByService, setBookingsByService] = useState<{ name: string; value: number }[]>([]);
  const [dailyBookings, setDailyBookings] = useState<{ date: string; count: number }[]>([]);
  const [leadsByStatus, setLeadsByStatus] = useState<{ name: string; value: number }[]>([]);
  const [campaignStats, setCampaignStats] = useState<{ name: string; sent: number; delivered: number; read: number }[]>([]);
  const [conversionRate, setConversionRate] = useState(0);

  const fetchAnalytics = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [customersRes, bookingsRes, testDrivesRes, convosRes, leadsRes, campaignsRes] = await Promise.all([
      supabase.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      supabase.from("service_bookings").select("id, status, service_type, booking_date").eq("tenant_id", tenantId),
      supabase.from("test_drive_bookings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      supabase.from("chatbot_conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      supabase.from("leads").select("id, status").eq("tenant_id", tenantId),
      supabase.from("campaigns").select("id, name, sent_count, delivered_count, read_count").eq("tenant_id", tenantId),
    ]);
    const bookings = bookingsRes.data || [];
    const leads = leadsRes.data || [];
    const campaigns = campaignsRes.data || [];
    setKpis({ customers: customersRes.count || 0, bookings: bookings.length, testDrives: testDrivesRes.count || 0, conversations: convosRes.count || 0, leads: leads.length, campaigns: campaigns.length });

    const statusMap: Record<string, number> = {};
    bookings.forEach((b) => { statusMap[b.status] = (statusMap[b.status] || 0) + 1; });
    setBookingsByStatus(Object.entries(statusMap).map(([name, value]) => ({ name: name.replace("_", " "), value })));

    const serviceMap: Record<string, number> = {};
    bookings.forEach((b) => { serviceMap[b.service_type] = (serviceMap[b.service_type] || 0) + 1; });
    setBookingsByService(Object.entries(serviceMap).map(([name, value]) => ({ name: name.replace("_", " "), value })));

    const dailyMap: Record<string, number> = {};
    for (let i = 13; i >= 0; i--) dailyMap[format(subDays(new Date(), i), "MMM d")] = 0;
    bookings.forEach((b) => { const d = format(new Date(b.booking_date), "MMM d"); if (dailyMap[d] !== undefined) dailyMap[d]++; });
    setDailyBookings(Object.entries(dailyMap).map(([date, count]) => ({ date, count })));

    const leadMap: Record<string, number> = {};
    leads.forEach((l) => { leadMap[l.status] = (leadMap[l.status] || 0) + 1; });
    setLeadsByStatus(Object.entries(leadMap).map(([name, value]) => ({ name, value })));
    const wonLeads = leads.filter((l) => l.status === "won").length;
    setConversionRate(leads.length > 0 ? Math.round((wonLeads / leads.length) * 100 * 10) / 10 : 0);

    setCampaignStats(campaigns.map((c) => ({ name: c.name, sent: c.sent_count || 0, delivered: c.delivered_count || 0, read: c.read_count || 0 })));
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

  if (loading) return (<><TopBar title="Analytics & Reports" /><div className="flex-1 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div></>);

  return (
    <>
      <TopBar title="Analytics & Reports" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard title="Customers" value={kpis.customers.toLocaleString()} icon={Users} delay={0} />
          <KpiCard title="Bookings" value={kpis.bookings.toLocaleString()} icon={Wrench} delay={50} />
          <KpiCard title="Test Drives" value={kpis.testDrives.toLocaleString()} icon={Car} delay={100} />
          <KpiCard title="Conversations" value={kpis.conversations.toLocaleString()} icon={MessageSquare} delay={150} />
          <KpiCard title="Leads" value={kpis.leads.toLocaleString()} icon={Target} delay={200} />
          <KpiCard title="Conversion" value={`${conversionRate}%`} icon={TrendingUp} delay={250} />
        </div>

        <Tabs defaultValue="bookings">
          <TabsList>
            <TabsTrigger value="bookings">Bookings</TabsTrigger>
            <TabsTrigger value="leads">Leads</TabsTrigger>
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          </TabsList>

          <TabsContent value="bookings" className="space-y-6 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="glass-card rounded-xl p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Daily Bookings (Last 14 Days)</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={dailyBookings}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="glass-card rounded-xl p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Bookings by Status</h3>
                {bookingsByStatus.length === 0 ? <p className="text-center text-muted-foreground py-12">No data</p> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={bookingsByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={11}>
                        {bookingsByStatus.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div className="glass-card rounded-xl p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Bookings by Service Type</h3>
              {bookingsByService.length === 0 ? <p className="text-center text-muted-foreground py-8">No data</p> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={bookingsByService} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={100} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="value" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </TabsContent>

          <TabsContent value="leads" className="space-y-6 mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="glass-card rounded-xl p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Lead Pipeline</h3>
                {leadsByStatus.length === 0 ? <p className="text-center text-muted-foreground py-12">No leads yet</p> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={leadsByStatus}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                      <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div className="glass-card rounded-xl p-5">
                <h3 className="text-sm font-semibold text-foreground mb-4">Conversion Summary</h3>
                <div className="space-y-4 py-4">
                  <div className="text-center">
                    <p className="text-4xl font-bold text-primary">{conversionRate}%</p>
                    <p className="text-sm text-muted-foreground mt-1">Lead to Won Conversion Rate</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-6">
                    <div className="p-3 bg-muted/50 rounded-lg text-center">
                      <p className="text-2xl font-bold text-foreground">{kpis.leads}</p>
                      <p className="text-xs text-muted-foreground">Total Leads</p>
                    </div>
                    <div className="p-3 bg-success/10 rounded-lg text-center">
                      <p className="text-2xl font-bold text-success">{leadsByStatus.find((l) => l.name === "won")?.value || 0}</p>
                      <p className="text-xs text-muted-foreground">Won</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="campaigns" className="space-y-6 mt-4">
            <div className="glass-card rounded-xl p-5">
              <h3 className="text-sm font-semibold text-foreground mb-4">Campaign Performance</h3>
              {campaignStats.length === 0 ? <p className="text-center text-muted-foreground py-12">No campaigns yet</p> : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={campaignStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
                    <Legend />
                    <Bar dataKey="sent" fill="hsl(var(--primary))" name="Sent" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="delivered" fill="hsl(var(--accent))" name="Delivered" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="read" fill="hsl(var(--success))" name="Read" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

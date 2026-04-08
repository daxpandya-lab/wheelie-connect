import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format, isToday, isFuture, startOfDay } from "date-fns";
import {
  Search, CalendarIcon, Loader2, RefreshCw, Phone, Wrench,
  Clock, CheckCircle, XCircle, Play, AlertCircle,
} from "lucide-react";

type ServiceBooking = {
  id: string;
  customer_name: string;
  phone_number: string;
  vehicle_model: string;
  kms_driven: number | null;
  service_type: string;
  booking_date: string;
  preferred_time: string | null;
  status: string;
  pickup_required: boolean | null;
  drop_required: boolean | null;
  notes: string | null;
  total_amount: number | null;
  created_at: string;
};

const STATUS_CONFIG: Record<string, { icon: typeof Clock; class: string }> = {
  pending: { icon: Clock, class: "bg-warning/10 text-warning" },
  confirmed: { icon: CheckCircle, class: "bg-info/10 text-info" },
  in_progress: { icon: Play, class: "bg-primary/10 text-primary" },
  completed: { icon: CheckCircle, class: "bg-success/10 text-success" },
  cancelled: { icon: XCircle, class: "bg-destructive/10 text-destructive" },
};

const SERVICE_TYPES = ["regular", "oil_change", "brake", "ac", "body_repair", "other"];

export default function ServiceBookingsPage() {
  const { tenantId } = useAuth();
  const [bookings, setBookings] = useState<ServiceBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceTypeFilter, setServiceTypeFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [tab, setTab] = useState("all");

  const fetchBookings = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    let query = supabase.from("service_bookings").select("*").eq("tenant_id", tenantId).order("booking_date", { ascending: false });
    if (statusFilter !== "all") query = query.eq("status", statusFilter as any);
    if (serviceTypeFilter !== "all") query = query.eq("service_type", serviceTypeFilter);
    if (dateFrom) query = query.gte("booking_date", format(dateFrom, "yyyy-MM-dd"));
    if (dateTo) query = query.lte("booking_date", format(dateTo, "yyyy-MM-dd"));
    if (search.trim()) query = query.ilike("customer_name", `%${search.trim()}%`);
    if (phoneSearch.trim()) query = query.ilike("phone_number", `%${phoneSearch.trim()}%`);
    const { data } = await query;
    if (data) setBookings(data);
    setLoading(false);
  }, [tenantId, statusFilter, serviceTypeFilter, dateFrom, dateTo, search, phoneSearch]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase.channel("sb_changes").on("postgres_changes", { event: "*", schema: "public", table: "service_bookings", filter: `tenant_id=eq.${tenantId}` }, () => fetchBookings()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId, fetchBookings]);

  const filterByTab = (list: ServiceBooking[]) => {
    switch (tab) {
      case "today": return list.filter((b) => isToday(new Date(b.booking_date)));
      case "upcoming": return list.filter((b) => isFuture(new Date(b.booking_date)) && !isToday(new Date(b.booking_date)));
      case "completed": return list.filter((b) => b.status === "completed");
      default: return list;
    }
  };

  const filtered = filterByTab(bookings);
  const todayCount = bookings.filter((b) => isToday(new Date(b.booking_date))).length;
  const upcomingCount = bookings.filter((b) => isFuture(new Date(b.booking_date)) && !isToday(new Date(b.booking_date))).length;
  const completedCount = bookings.filter((b) => b.status === "completed").length;

  const handleStatusUpdate = async (id: string, newStatus: string) => {
    await supabase.from("service_bookings").update({ status: newStatus as any }).eq("id", id);
  };

  return (
    <>
      <TopBar title="Service Bookings" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total", value: bookings.length, icon: Wrench, color: "text-primary" },
            { label: "Today", value: todayCount, icon: CalendarIcon, color: "text-info" },
            { label: "Upcoming", value: upcomingCount, icon: Clock, color: "text-warning" },
            { label: "Completed", value: completedCount, icon: CheckCircle, color: "text-success" },
          ].map((kpi) => (
            <div key={kpi.label} className="glass-card rounded-xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center">
                <kpi.icon className={`w-4 h-4 ${kpi.color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="text-lg font-bold text-foreground">{kpi.value}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="glass-card rounded-xl p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search customer..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 text-sm" />
            </div>
            <div className="relative min-w-[160px]">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search phone..." value={phoneSearch} onChange={(e) => setPhoneSearch(e.target.value)} className="pl-9 h-9 text-sm" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[130px] text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={serviceTypeFilter} onValueChange={setServiceTypeFilter}>
              <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue placeholder="Service Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {SERVICE_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5">
                  <CalendarIcon className="w-3.5 h-3.5" />
                  {dateFrom ? format(dateFrom, "MMM d") : "From"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5">
                  <CalendarIcon className="w-3.5 h-3.5" />
                  {dateTo ? format(dateTo, "MMM d") : "To"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar mode="single" selected={dateTo} onSelect={setDateTo} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            {(search || phoneSearch || statusFilter !== "all" || serviceTypeFilter !== "all" || dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" className="h-9" onClick={() => { setSearch(""); setPhoneSearch(""); setStatusFilter("all"); setServiceTypeFilter("all"); setDateFrom(undefined); setDateTo(undefined); }}>Clear</Button>
            )}
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={fetchBookings}><RefreshCw className="w-4 h-4" /></Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All ({bookings.length})</TabsTrigger>
            <TabsTrigger value="today">Today ({todayCount})</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming ({upcomingCount})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completedCount})</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-4">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 glass-card rounded-xl">
                <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">No bookings found</p>
              </div>
            ) : (
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium">Customer</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium">Phone</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden lg:table-cell">Vehicle</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium">Service</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium">Date</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden md:table-cell">KMs</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((b) => {
                        const sc = STATUS_CONFIG[b.status] || STATUS_CONFIG.pending;
                        const StatusIcon = sc.icon;
                        return (
                          <tr key={b.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                            <td className="py-3 px-4 font-medium text-foreground">{b.customer_name}</td>
                            <td className="py-3 px-4 text-muted-foreground font-mono text-xs">{b.phone_number}</td>
                            <td className="py-3 px-4 text-foreground hidden lg:table-cell">{b.vehicle_model}</td>
                            <td className="py-3 px-4"><Badge variant="outline" className="text-xs capitalize">{b.service_type.replace("_", " ")}</Badge></td>
                            <td className="py-3 px-4 text-foreground">{format(new Date(b.booking_date), "MMM d, yyyy")}{b.preferred_time && <span className="text-xs text-muted-foreground block">{b.preferred_time}</span>}</td>
                            <td className="py-3 px-4"><span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${sc.class}`}><StatusIcon className="w-3 h-3" />{b.status.replace("_", " ")}</span></td>
                            <td className="py-3 px-4 text-muted-foreground hidden md:table-cell">{b.kms_driven ? `${b.kms_driven.toLocaleString()} km` : "—"}</td>
                            <td className="py-3 px-4">
                              <Select value={b.status} onValueChange={(v) => handleStatusUpdate(b.id, v)}>
                                <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="pending">Pending</SelectItem>
                                  <SelectItem value="confirmed">Confirmed</SelectItem>
                                  <SelectItem value="in_progress">In Progress</SelectItem>
                                  <SelectItem value="completed">Completed</SelectItem>
                                  <SelectItem value="cancelled">Cancelled</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

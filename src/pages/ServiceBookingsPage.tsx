import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { format, isToday, isFuture } from "date-fns";
import {
  Search, CalendarIcon, Loader2, RefreshCw, Phone, Wrench,
  Clock, CheckCircle, XCircle, Play, AlertCircle, Eye, ClipboardList, Bot, User, Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { useDynamicColumns } from "@/hooks/useDynamicColumns";
import ColumnManagerDialog from "@/components/reports/ColumnManagerDialog";
import DynamicReportTable from "@/components/reports/DynamicReportTable";

type ServiceBooking = {
  id: string; customer_name: string; phone_number: string; vehicle_model: string;
  kms_driven: number | null; service_type: string; booking_date: string;
  preferred_time: string | null; status: string; pickup_required: boolean | null;
  drop_required: boolean | null; notes: string | null; total_amount: number | null;
  assigned_to: string | null; issue_description: string | null;
  estimated_cost: number | null; approval_status: string | null;
  quotation_notes: string | null; work_notes: string | null;
  parts_required: string | null; created_at: string; booking_source: string;
  metadata: Record<string, unknown> | null;
};

const FIXED_COLS = [
  { key: "customer_name", label: "Customer" },
  { key: "phone_number", label: "Phone" },
  { key: "vehicle_model", label: "Vehicle" },
  { key: "service_type", label: "Service" },
  { key: "booking_date", label: "Date" },
  { key: "status", label: "Status" },
  { key: "approval_status", label: "Approval" },
  { key: "booking_source", label: "Source" },
];

type Profile = { user_id: string; full_name: string | null };

const STATUS_FLOW = [
  { value: "pending", label: "Pending", icon: Clock, class: "bg-warning/10 text-warning" },
  { value: "confirmed", label: "Inspection Done", icon: Eye, class: "bg-info/10 text-info" },
  { value: "in_progress", label: "In Progress", icon: Play, class: "bg-accent/10 text-accent-foreground" },
  { value: "completed", label: "Completed", icon: CheckCircle, class: "bg-success/10 text-success" },
  { value: "cancelled", label: "Cancelled", icon: XCircle, class: "bg-destructive/10 text-destructive" },
];

const SERVICE_TYPES = ["Oil Change", "General Service", "Repair", "Inspection", "Custom"];

function SourceBadge({ source }: { source: string }) {
  if (source === "ai_bot") {
    return <Badge variant="outline" className="text-xs gap-1 bg-primary/10 text-primary border-primary/20"><Bot className="w-3 h-3" />AI Bot</Badge>;
  }
  return <Badge variant="outline" className="text-xs gap-1 bg-muted text-muted-foreground"><User className="w-3 h-3" />Manual</Badge>;
}

export default function ServiceBookingsPage() {
  const { tenantId, roles, user } = useAuth();
  const isExecutive = roles.includes("staff") && !roles.includes("tenant_admin") && !roles.includes("super_admin");

  const [bookings, setBookings] = useState<ServiceBooking[]>([]);
  const [teamMembers, setTeamMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [phoneSearch, setPhoneSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceTypeFilter, setServiceTypeFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [tab, setTab] = useState("all");
  const [colMgrOpen, setColMgrOpen] = useState(false);
  const { columns, savePrefs } = useDynamicColumns("service_bookings", FIXED_COLS, bookings as any);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<ServiceBooking | null>(null);
  const [jobForm, setJobForm] = useState({ work_notes: "", parts_required: "", estimated_cost: "", approval_status: "pending", status: "pending", executive_notes: "" });
  const [saving, setSaving] = useState(false);

  const fetchBookings = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [bookRes, teamRes] = await Promise.all([
      (() => {
        let query = supabase.from("service_bookings").select("*").eq("tenant_id", tenantId).order("booking_date", { ascending: false });
        if (isExecutive && user?.id) query = query.eq("assigned_to", user.id);
        if (statusFilter !== "all") query = query.eq("status", statusFilter as any);
        if (serviceTypeFilter !== "all") query = query.ilike("service_type", `%${serviceTypeFilter}%`);
        if (sourceFilter !== "all") query = query.eq("booking_source", sourceFilter);
        if (dateFrom) query = query.gte("booking_date", format(dateFrom, "yyyy-MM-dd"));
        if (dateTo) query = query.lte("booking_date", format(dateTo, "yyyy-MM-dd"));
        if (search.trim()) query = query.ilike("customer_name", `%${search.trim()}%`);
        if (phoneSearch.trim()) query = query.ilike("phone_number", `%${phoneSearch.trim()}%`);
        return query;
      })(),
      supabase.from("profiles").select("user_id, full_name").eq("tenant_id", tenantId),
    ]);
    if (bookRes.data) setBookings(bookRes.data as ServiceBooking[]);
    if (teamRes.data) setTeamMembers(teamRes.data);
    setLoading(false);
  }, [tenantId, statusFilter, serviceTypeFilter, sourceFilter, dateFrom, dateTo, search, phoneSearch, isExecutive, user?.id]);

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase.channel("sb_changes").on("postgres_changes", { event: "*", schema: "public", table: "service_bookings", filter: `tenant_id=eq.${tenantId}` }, () => fetchBookings()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId, fetchBookings]);

  const filterByTab = (list: ServiceBooking[]) => {
    switch (tab) {
      case "today": return list.filter(b => isToday(new Date(b.booking_date)));
      case "upcoming": return list.filter(b => isFuture(new Date(b.booking_date)) && !isToday(new Date(b.booking_date)));
      case "completed": return list.filter(b => b.status === "completed");
      default: return list;
    }
  };

  const filtered = filterByTab(bookings);
  const todayCount = bookings.filter(b => isToday(new Date(b.booking_date))).length;
  const upcomingCount = bookings.filter(b => isFuture(new Date(b.booking_date)) && !isToday(new Date(b.booking_date))).length;
  const completedCount = bookings.filter(b => b.status === "completed").length;

  const getTeamName = (id: string | null) => {
    if (!id) return "—";
    return teamMembers.find(t => t.user_id === id)?.full_name || "Unknown";
  };

  const openJobDetail = (b: ServiceBooking) => {
    setSelectedJob(b);
    setJobForm({
      work_notes: b.work_notes || "", parts_required: b.parts_required || "",
      estimated_cost: b.estimated_cost?.toString() || "",
      approval_status: b.approval_status || "pending", status: b.status,
      executive_notes: (b as any).executive_notes || "",
    });
    setDetailOpen(true);
  };

  const saveJobDetail = async () => {
    if (!selectedJob) return;
    setSaving(true);
    const updateData: Record<string, unknown> = {
      work_notes: jobForm.work_notes || null,
      parts_required: jobForm.parts_required || null,
      estimated_cost: jobForm.estimated_cost ? parseFloat(jobForm.estimated_cost) : null,
      status: jobForm.status as any,
      executive_notes: jobForm.executive_notes || null,
    };
    if (!isExecutive) {
      updateData.approval_status = jobForm.approval_status;
    }
    const { error } = await supabase.from("service_bookings").update(updateData as any).eq("id", selectedJob.id);
    if (error) toast.error(error.message);
    else { toast.success("Job updated"); setDetailOpen(false); fetchBookings(); }
    setSaving(false);
  };

  const handleAssign = async (bookingId: string, userId: string) => {
    const { error } = await supabase.from("service_bookings").update({ assigned_to: userId || null } as any).eq("id", bookingId);
    if (error) toast.error(error.message);
    else { toast.success("Assigned"); fetchBookings(); }
  };

  const getStatusConfig = (status: string) => STATUS_FLOW.find(s => s.value === status) || STATUS_FLOW[0];

  return (
    <>
      <TopBar title={isExecutive ? "My Assigned Jobs" : "Service Bookings"} />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total", value: bookings.length, icon: Wrench, color: "text-primary" },
            { label: "Today", value: todayCount, icon: CalendarIcon, color: "text-info" },
            { label: "Upcoming", value: upcomingCount, icon: Clock, color: "text-warning" },
            { label: "Completed", value: completedCount, icon: CheckCircle, color: "text-success" },
          ].map(kpi => (
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

        {/* Filters */}
        <div className="glass-card rounded-xl p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search customer..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9 text-sm" />
            </div>
            <div className="relative min-w-[160px]">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search phone..." value={phoneSearch} onChange={e => setPhoneSearch(e.target.value)} className="pl-9 h-9 text-sm" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-[130px] text-sm"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {STATUS_FLOW.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={serviceTypeFilter} onValueChange={setServiceTypeFilter}>
              <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue placeholder="Service Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {SERVICE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="ai_bot">AI Bot</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
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
            {(search || phoneSearch || statusFilter !== "all" || serviceTypeFilter !== "all" || sourceFilter !== "all" || dateFrom || dateTo) && (
              <Button variant="ghost" size="sm" className="h-9" onClick={() => { setSearch(""); setPhoneSearch(""); setStatusFilter("all"); setServiceTypeFilter("all"); setSourceFilter("all"); setDateFrom(undefined); setDateTo(undefined); }}>Clear</Button>
            )}
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => setColMgrOpen(true)}><Settings2 className="w-4 h-4" />Manage Columns</Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={fetchBookings}><RefreshCw className="w-4 h-4" /></Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="all">All ({bookings.length})</TabsTrigger>
            <TabsTrigger value="today">Today ({todayCount})</TabsTrigger>
            <TabsTrigger value="upcoming">Upcoming ({upcomingCount})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completedCount})</TabsTrigger>
            <TabsTrigger value="report">Report</TabsTrigger>
          </TabsList>
          <TabsContent value={tab} className="mt-4">
            {tab === "report" ? (
              <DynamicReportTable columns={columns} rows={bookings as any} emptyMessage="No bookings yet." />
            ) : loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 glass-card rounded-xl">
                <AlertCircle className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">{isExecutive ? "No jobs assigned to you" : "No bookings found"}</p>
              </div>
            ) : (
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium">Customer</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden lg:table-cell">Vehicle</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium">Service</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium">Source</th>
                        {!isExecutive && <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden md:table-cell">Assigned</th>}
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium">Status</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium hidden md:table-cell">Approval</th>
                        <th className="text-left py-3 px-4 text-muted-foreground font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(b => {
                        const sc = getStatusConfig(b.status);
                        const StatusIcon = sc.icon;
                        return (
                          <tr key={b.id} className="border-b border-border/50 last:border-0 hover:bg-muted/20 transition-colors">
                            <td className="py-3 px-4">
                              <p className="font-medium text-foreground">{b.customer_name}</p>
                              <p className="text-xs text-muted-foreground font-mono">{b.phone_number}</p>
                            </td>
                            <td className="py-3 px-4 text-foreground hidden lg:table-cell">{b.vehicle_model}</td>
                            <td className="py-3 px-4">
                              <Badge variant="outline" className="text-xs capitalize">{b.service_type}</Badge>
                            </td>
                            <td className="py-3 px-4">
                              <SourceBadge source={b.booking_source || "manual"} />
                            </td>
                            {!isExecutive && (
                              <td className="py-3 px-4 hidden md:table-cell">
                                <Select value={b.assigned_to || ""} onValueChange={v => handleAssign(b.id, v)}>
                                  <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue placeholder="Assign" /></SelectTrigger>
                                  <SelectContent>
                                    {teamMembers.map(t => (
                                      <SelectItem key={t.user_id} value={t.user_id}>{t.full_name || "Unnamed"}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                            )}
                            <td className="py-3 px-4">
                              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${sc.class}`}>
                                <StatusIcon className="w-3 h-3" />{sc.label}
                              </span>
                            </td>
                            <td className="py-3 px-4 hidden md:table-cell">
                              <Badge variant="outline" className={`text-xs ${
                                b.approval_status === "approved" ? "bg-success/10 text-success border-success/20" :
                                b.approval_status === "rejected" ? "bg-destructive/10 text-destructive border-destructive/20" :
                                "bg-warning/10 text-warning border-warning/20"
                              }`}>
                                {b.approval_status || "pending"}
                              </Badge>
                            </td>
                            <td className="py-3 px-4">
                              <Button variant="ghost" size="sm" onClick={() => openJobDetail(b)}>
                                <ClipboardList className="w-4 h-4 mr-1" /> Details
                              </Button>
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

      {/* Job Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Job Details — {selectedJob?.customer_name}</DialogTitle>
          </DialogHeader>
          {selectedJob && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-muted-foreground">Vehicle:</span> <span className="text-foreground font-medium">{selectedJob.vehicle_model}</span></div>
                <div><span className="text-muted-foreground">Service:</span> <span className="text-foreground font-medium">{selectedJob.service_type}</span></div>
                <div><span className="text-muted-foreground">Date:</span> <span className="text-foreground">{selectedJob.booking_date}</span></div>
                <div><span className="text-muted-foreground">Phone:</span> <span className="text-foreground font-mono text-xs">{selectedJob.phone_number}</span></div>
                <div><span className="text-muted-foreground">Source:</span> <SourceBadge source={selectedJob.booking_source || "manual"} /></div>
                {!isExecutive && selectedJob.assigned_to && (
                  <div className="col-span-2"><span className="text-muted-foreground">Assigned To:</span> <span className="text-foreground font-medium">{getTeamName(selectedJob.assigned_to)}</span></div>
                )}
              </div>

              <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/30">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Issue Description (from Dealer)</Label>
                <p className="text-sm text-foreground whitespace-pre-wrap">{selectedJob.issue_description || "No issue description provided"}</p>
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  Executive Notes
                  {isExecutive && <Badge variant="outline" className="text-xs">You can edit</Badge>}
                </Label>
                {isExecutive ? (
                  <Textarea
                    value={jobForm.executive_notes}
                    onChange={e => setJobForm(f => ({ ...f, executive_notes: e.target.value }))}
                    placeholder="Add your observations, findings, work updates..."
                    rows={4}
                  />
                ) : (
                  <div className="rounded-lg border border-border p-3 bg-muted/30 min-h-[60px]">
                    <p className="text-sm text-foreground whitespace-pre-wrap">{(selectedJob as any).executive_notes || "No notes from executive yet"}</p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={jobForm.status} onValueChange={v => setJobForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_FLOW.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Work Notes</Label>
                <Textarea value={jobForm.work_notes} onChange={e => setJobForm(f => ({ ...f, work_notes: e.target.value }))} placeholder="Work done, findings..." rows={3} />
              </div>

              <div className="space-y-2">
                <Label>Parts Required</Label>
                <Textarea value={jobForm.parts_required} onChange={e => setJobForm(f => ({ ...f, parts_required: e.target.value }))} placeholder="List parts needed..." rows={2} />
              </div>

              <div className="space-y-2">
                <Label>Estimated Cost (₹)</Label>
                <Input type="number" value={jobForm.estimated_cost} onChange={e => setJobForm(f => ({ ...f, estimated_cost: e.target.value }))} placeholder="0" />
              </div>

              {!isExecutive && (
                <div className="space-y-2">
                  <Label>Approval Status</Label>
                  <Select value={jobForm.approval_status} onValueChange={v => setJobForm(f => ({ ...f, approval_status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Cancel</Button>
            <Button onClick={saveJobDetail} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

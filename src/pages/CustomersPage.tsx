import { useState, useEffect } from "react";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search, Plus, MoreHorizontal, Car, Wrench, FileText,
  ChevronRight, Phone, Mail, MapPin,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const SERVICE_TYPES = ["Oil Change", "General Service", "Repair", "Inspection", "Custom"];
const VEHICLE_TYPES = ["Two Wheeler", "Car", "SUV", "Truck", "Commercial"];

type Customer = {
  id: string; tenant_id: string; name: string; phone: string | null;
  email: string | null; city: string | null; area: string | null;
};
type Vehicle = {
  id: string; customer_id: string; tenant_id: string; model: string;
  license_plate: string | null; vehicle_type: string | null;
  kms_driven: number | null; make: string | null;
};
type Booking = {
  id: string; customer_id: string | null; tenant_id: string;
  customer_name: string; phone_number: string; vehicle_model: string;
  service_type: string; status: string; assigned_to: string | null;
  issue_description: string | null; estimated_cost: number | null;
  approval_status: string | null; quotation_notes: string | null;
  booking_date: string; vehicle_id: string | null;
};
type Profile = { user_id: string; full_name: string | null };

export default function CustomersPage() {
  const { tenantId, roles, user } = useAuth();
  const isExecutive = roles.includes("staff") && !roles.includes("tenant_admin") && !roles.includes("super_admin");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [teamMembers, setTeamMembers] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [showCreate, setShowCreate] = useState(false);
  const [showQuotation, setShowQuotation] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [activeTab, setActiveTab] = useState("customers");

  // Form state
  const [form, setForm] = useState({
    name: "", phone: "", email: "", city: "", area: "",
    vehicle_number: "", vehicle_model: "", vehicle_type: "",
    kms_driven: "", service_type: "", issue_description: "",
    assigned_to: "",
  });
  const [quotForm, setQuotForm] = useState({
    estimated_cost: "", quotation_notes: "", approval_status: "pending",
  });
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    if (!tenantId) return;
    setLoading(true);

    // Build bookings query with RBAC filtering
    let bookQuery = supabase.from("service_bookings").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
    if (isExecutive && user?.id) {
      bookQuery = bookQuery.eq("assigned_to", user.id);
    }

    const [custRes, bookRes, teamRes] = await Promise.all([
      supabase.from("customers").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      bookQuery,
      supabase.from("profiles").select("user_id, full_name").eq("tenant_id", tenantId),
    ]);

    let allCustomers = (custRes.data || []) as Customer[];
    const allBookings = (bookRes.data || []) as Booking[];

    // For executives, only show customers that have bookings assigned to them
    if (isExecutive && user?.id) {
      const assignedCustomerIds = new Set(allBookings.map(b => b.customer_id).filter(Boolean));
      allCustomers = allCustomers.filter(c => assignedCustomerIds.has(c.id));
    }

    setCustomers(allCustomers);
    setBookings(allBookings);
    if (teamRes.data) setTeamMembers(teamRes.data);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [tenantId]);

  const handleCreate = async () => {
    if (!tenantId || !form.name || !form.phone) {
      toast.error("Name and Phone are required");
      return;
    }
    setSubmitting(true);
    try {
      // 1. Create customer
      const { data: cust, error: custErr } = await supabase
        .from("customers")
        .insert({
          tenant_id: tenantId, name: form.name, phone: form.phone,
          email: form.email || null, city: form.city || null, area: form.area || null,
        })
        .select().single();
      if (custErr) throw custErr;

      // 2. Create vehicle if provided
      let vehicleId: string | null = null;
      if (form.vehicle_model) {
        const { data: veh, error: vehErr } = await supabase
          .from("vehicles")
          .insert({
            tenant_id: tenantId, customer_id: cust.id, model: form.vehicle_model,
            license_plate: form.vehicle_number || null,
            vehicle_type: form.vehicle_type || null,
            kms_driven: form.kms_driven ? parseInt(form.kms_driven) : null,
          })
          .select().single();
        if (vehErr) throw vehErr;
        vehicleId = veh.id;
      }

      // 3. Create service booking if service type provided
      if (form.service_type) {
        const { error: bookErr } = await supabase
          .from("service_bookings")
          .insert({
            tenant_id: tenantId, customer_id: cust.id, vehicle_id: vehicleId,
            customer_name: form.name, phone_number: form.phone,
            vehicle_model: form.vehicle_model || "N/A",
            service_type: form.service_type,
            issue_description: form.issue_description || null,
            assigned_to: form.assigned_to || null,
            booking_date: new Date().toISOString().split("T")[0],
            status: "pending", approval_status: "pending",
          });
        if (bookErr) throw bookErr;
      }

      toast.success("Customer created successfully");
      setShowCreate(false);
      setForm({ name: "", phone: "", email: "", city: "", area: "", vehicle_number: "", vehicle_model: "", vehicle_type: "", kms_driven: "", service_type: "", issue_description: "", assigned_to: "" });
      fetchData();
    } catch (e: any) {
      toast.error(e.message || "Failed to create customer");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (booking: Booking, newStatus: string) => {
    const { error } = await supabase
      .from("service_bookings")
      .update({ status: newStatus } as any)
      .eq("id", booking.id);
    if (error) toast.error(error.message);
    else { toast.success("Status updated"); fetchData(); }
  };

  const handleQuotationSave = async () => {
    if (!selectedBooking) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("service_bookings")
      .update({
        estimated_cost: quotForm.estimated_cost ? parseFloat(quotForm.estimated_cost) : null,
        quotation_notes: quotForm.quotation_notes || null,
        approval_status: quotForm.approval_status,
      } as any)
      .eq("id", selectedBooking.id);
    if (error) toast.error(error.message);
    else { toast.success("Quotation updated"); setShowQuotation(false); fetchData(); }
    setSubmitting(false);
  };

  const openQuotation = (b: Booking) => {
    setSelectedBooking(b);
    setQuotForm({
      estimated_cost: b.estimated_cost?.toString() || "",
      quotation_notes: b.quotation_notes || "",
      approval_status: b.approval_status || "pending",
    });
    setShowQuotation(true);
  };

  const getTeamName = (id: string | null) => {
    if (!id) return "—";
    return teamMembers.find(t => t.user_id === id)?.full_name || "Unknown";
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: "bg-warning/10 text-warning border-warning/20",
      confirmed: "bg-primary/10 text-primary border-primary/20",
      in_progress: "bg-accent/10 text-accent-foreground border-accent/20",
      completed: "bg-success/10 text-success border-success/20",
      cancelled: "bg-destructive/10 text-destructive border-destructive/20",
    };
    return map[s] || "bg-muted text-muted-foreground";
  };

  const approvalBadge = (s: string | null) => {
    if (!s || s === "pending") return "bg-warning/10 text-warning border-warning/20";
    if (s === "approved") return "bg-success/10 text-success border-success/20";
    return "bg-destructive/10 text-destructive border-destructive/20";
  };

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search) || c.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <TopBar title="Customer CRM" />
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Customers", value: customers.length },
            { label: "Active Bookings", value: bookings.filter(b => b.status !== "completed" && b.status !== "cancelled").length },
            { label: "Pending Approvals", value: bookings.filter(b => b.approval_status === "pending" && b.estimated_cost).length },
            { label: "Completed", value: bookings.filter(b => b.status === "completed").length },
          ].map(k => (
            <div key={k.label} className="glass-card rounded-xl p-4">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-2xl font-bold text-foreground">{k.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search customers..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 w-72"
            />
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-1" /> Add Customer
          </Button>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="customers">Customers</TabsTrigger>
            <TabsTrigger value="bookings">Service Bookings</TabsTrigger>
            <TabsTrigger value="quotations">Quotations</TabsTrigger>
          </TabsList>

          {/* Customers Tab */}
          <TabsContent value="customers">
            <div className="glass-card rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50">
                    <TableHead>Customer</TableHead>
                    <TableHead className="hidden md:table-cell">Contact</TableHead>
                    <TableHead className="hidden lg:table-cell">Location</TableHead>
                    <TableHead>Bookings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No customers found</TableCell></TableRow>
                  ) : filtered.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
                            {c.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                          </div>
                          <div>
                            <p className="font-medium text-foreground">{c.name}</p>
                            <p className="text-xs text-muted-foreground md:hidden">{c.phone}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="space-y-1 text-xs text-muted-foreground">
                          {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{c.phone}</span>}
                          {c.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{c.email}</span>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {(c.city || c.area) && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="w-3 h-3" />{[c.area, c.city].filter(Boolean).join(", ")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {bookings.filter(b => b.customer_id === c.id).length} bookings
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Bookings Tab */}
          <TabsContent value="bookings">
            <div className="glass-card rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50">
                    <TableHead>Customer</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead className="hidden md:table-cell">Service</TableHead>
                    <TableHead className="hidden lg:table-cell">Assigned To</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No bookings</TableCell></TableRow>
                  ) : bookings.map(b => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <p className="font-medium text-foreground">{b.customer_name}</p>
                        <p className="text-xs text-muted-foreground">{b.phone_number}</p>
                      </TableCell>
                      <TableCell className="text-foreground">{b.vehicle_model}</TableCell>
                      <TableCell className="hidden md:table-cell text-foreground">{b.service_type}</TableCell>
                      <TableCell className="hidden lg:table-cell text-muted-foreground">{getTeamName(b.assigned_to)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadge(b.status)}>{b.status.replace("_", " ")}</Badge>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleStatusChange(b, "confirmed")}>Mark Confirmed</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(b, "in_progress")}>Mark In Progress</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(b, "completed")}>Mark Completed</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleStatusChange(b, "cancelled")}>Cancel</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openQuotation(b)}>
                              <FileText className="w-4 h-4 mr-2" /> Quotation
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Quotations Tab */}
          <TabsContent value="quotations">
            <div className="glass-card rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-secondary/50">
                    <TableHead>Customer</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Est. Cost</TableHead>
                    <TableHead>Approval</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bookings.filter(b => b.estimated_cost).length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No quotations yet</TableCell></TableRow>
                  ) : bookings.filter(b => b.estimated_cost).map(b => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium text-foreground">{b.customer_name}</TableCell>
                      <TableCell className="text-foreground">{b.service_type}</TableCell>
                      <TableCell className="text-foreground font-medium">₹{b.estimated_cost?.toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={approvalBadge(b.approval_status)}>
                          {b.approval_status || "pending"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => openQuotation(b)}>Edit</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Create Customer Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {/* Customer Section */}
            <div>
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs">1</span>
                Customer Details
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Name *</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Phone *</Label>
                  <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">City</Label>
                  <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Area</Label>
                  <Input value={form.area} onChange={e => setForm(f => ({ ...f, area: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Vehicle Section */}
            <div>
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs">2</span>
                <Car className="w-4 h-4" /> Vehicle Details
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Vehicle Number</Label>
                  <Input value={form.vehicle_number} onChange={e => setForm(f => ({ ...f, vehicle_number: e.target.value }))} placeholder="MH 01 AB 1234" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vehicle Model</Label>
                  <Input value={form.vehicle_model} onChange={e => setForm(f => ({ ...f, vehicle_model: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vehicle Type</Label>
                  <Select value={form.vehicle_type} onValueChange={v => setForm(f => ({ ...f, vehicle_type: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {VEHICLE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">KMs Driven</Label>
                  <Input type="number" value={form.kms_driven} onChange={e => setForm(f => ({ ...f, kms_driven: e.target.value }))} />
                </div>
              </div>
            </div>

            {/* Service Section */}
            <div>
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs">3</span>
                <Wrench className="w-4 h-4" /> Service Details
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Service Type</Label>
                  <Select value={form.service_type} onValueChange={v => setForm(f => ({ ...f, service_type: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select service" /></SelectTrigger>
                    <SelectContent>
                      {SERVICE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Assign To</Label>
                  <Select value={form.assigned_to} onValueChange={v => setForm(f => ({ ...f, assigned_to: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select staff" /></SelectTrigger>
                    <SelectContent>
                      {teamMembers.map(t => (
                        <SelectItem key={t.user_id} value={t.user_id}>{t.full_name || "Unnamed"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Issue Description</Label>
                  <Textarea value={form.issue_description} onChange={e => setForm(f => ({ ...f, issue_description: e.target.value }))} rows={3} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? "Creating..." : "Create Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quotation Dialog */}
      <Dialog open={showQuotation} onOpenChange={setShowQuotation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quotation — {selectedBooking?.customer_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Estimated Cost (₹)</Label>
              <Input type="number" value={quotForm.estimated_cost} onChange={e => setQuotForm(f => ({ ...f, estimated_cost: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quotation Notes</Label>
              <Textarea value={quotForm.quotation_notes} onChange={e => setQuotForm(f => ({ ...f, quotation_notes: e.target.value }))} rows={3} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Approval Status</Label>
              <Select value={quotForm.approval_status} onValueChange={v => setQuotForm(f => ({ ...f, approval_status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowQuotation(false)}>Cancel</Button>
            <Button onClick={handleQuotationSave} disabled={submitting}>
              {submitting ? "Saving..." : "Save Quotation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

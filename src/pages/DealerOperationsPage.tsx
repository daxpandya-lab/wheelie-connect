import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wrench, TestTube2, FileText, Package, ClipboardList, Eye } from "lucide-react";
import { Label } from "@/components/ui/label";

interface TenantLite { id: string; name: string; }

export default function DealerOperationsPage() {
  const { isSuperAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tenants, setTenants] = useState<TenantLite[]>([]);
  const [tenantId, setTenantId] = useState<string>(searchParams.get("tenant") || "");
  const [loadingTenants, setLoadingTenants] = useState(true);

  const [bookings, setBookings] = useState<any[]>([]);
  const [drives, setDrives] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("tenants")
        .select("id,name")
        .order("name", { ascending: true });
      if (data) setTenants(data as TenantLite[]);
      setLoadingTenants(false);
    })();
  }, []);

  // Sync ?tenant= query param ↔ selection (for one-click impersonation)
  useEffect(() => {
    const q = searchParams.get("tenant") || "";
    if (q && q !== tenantId) setTenantId(q);
  }, [searchParams]);

  const handleSelectTenant = (id: string) => {
    setTenantId(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set("tenant", id); else next.delete("tenant");
    setSearchParams(next, { replace: true });
  };

  const loadOps = useCallback(async (tid: string) => {
    if (!tid) return;
    setLoadingData(true);
    const [{ data: b }, { data: d }, { data: inv }] = await Promise.all([
      supabase.from("service_bookings").select("*").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(100),
      supabase.from("test_drive_bookings").select("*").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(100),
      supabase.from("tenant_invoices" as any).select("*").eq("tenant_id", tid).order("created_at", { ascending: false }).limit(100),
    ]);
    setBookings((b as any[]) || []);
    setDrives((d as any[]) || []);
    setInvoices((inv as any[]) || []);
    setLoadingData(false);
  }, []);

  useEffect(() => { if (tenantId) loadOps(tenantId); }, [tenantId, loadOps]);

  const selected = useMemo(() => tenants.find(t => t.id === tenantId), [tenants, tenantId]);

  if (!isSuperAdmin) return <div className="p-6 text-muted-foreground">Access denied</div>;

  return (
    <>
      <TopBar title="Dealer Operations Workspace" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="rounded-xl border bg-card p-4 flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="flex-1 max-w-md space-y-2">
            <Label>Select dealer / tenant</Label>
            <Select value={tenantId} onValueChange={setTenantId} disabled={loadingTenants}>
              <SelectTrigger>
                <SelectValue placeholder={loadingTenants ? "Loading dealers…" : "Choose a dealer to inspect"} />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selected && (
            <div className="text-sm text-muted-foreground">
              Viewing live operations for <span className="font-medium text-foreground">{selected.name}</span>
            </div>
          )}
        </div>

        {!tenantId ? (
          <div className="rounded-xl border bg-card p-12 text-center text-muted-foreground">
            Pick a dealer above to review their Service Bookings, Estimation, Job Cards, Parts and Invoices in one place.
          </div>
        ) : loadingData ? (
          <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <Tabs defaultValue="bookings" className="space-y-4">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="bookings"><Wrench className="w-4 h-4 mr-1" /> Service Bookings</TabsTrigger>
              <TabsTrigger value="estimation"><ClipboardList className="w-4 h-4 mr-1" /> Estimation</TabsTrigger>
              <TabsTrigger value="jobcards"><ClipboardList className="w-4 h-4 mr-1" /> Job Cards</TabsTrigger>
              <TabsTrigger value="parts"><Package className="w-4 h-4 mr-1" /> Parts Tracking</TabsTrigger>
              <TabsTrigger value="invoices"><FileText className="w-4 h-4 mr-1" /> Invoices</TabsTrigger>
              <TabsTrigger value="testdrives"><TestTube2 className="w-4 h-4 mr-1" /> Test Drives</TabsTrigger>
            </TabsList>

            <TabsContent value="bookings">
              <BookingsTable rows={bookings} />
            </TabsContent>
            <TabsContent value="estimation">
              <BookingsTable rows={bookings.filter(b => b.estimate_amount || b.status === "estimate_sent" || b.status === "estimate_approved")} columns={["customer_name","vehicle_model","estimate_amount","status","booking_date"]} />
            </TabsContent>
            <TabsContent value="jobcards">
              <BookingsTable rows={bookings.filter(b => ["in_progress","ready","completed"].includes(b.status))} columns={["customer_name","vehicle_model","service_type","status","booking_date"]} />
            </TabsContent>
            <TabsContent value="parts">
              <PartsTable rows={bookings.filter(b => Array.isArray(b.parts_used) && b.parts_used.length > 0)} />
            </TabsContent>
            <TabsContent value="invoices">
              <InvoicesTable rows={invoices} fallback={bookings.filter(b => b.invoice_url)} />
            </TabsContent>
            <TabsContent value="testdrives">
              <DrivesTable rows={drives} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  );
}

function statusBadge(s: string) {
  return <Badge variant="outline" className="text-xs capitalize">{(s || "—").replace(/_/g, " ")}</Badge>;
}

function BookingsTable({ rows, columns }: { rows: any[]; columns?: string[] }) {
  const cols = columns || ["customer_name", "phone_number", "vehicle_model", "service_type", "status", "booking_date"];
  if (!rows.length) return <Empty label="No records" />;
  return (
    <div className="rounded-xl border bg-card overflow-x-auto">
      <Table>
        <TableHeader><TableRow>{cols.map(c => <TableHead key={c} className="capitalize">{c.replace(/_/g, " ")}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              {cols.map(c => (
                <TableCell key={c} className="text-sm">
                  {c === "status" ? statusBadge(r[c])
                    : c.endsWith("_date") && r[c] ? new Date(r[c]).toLocaleDateString()
                    : r[c] ?? "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function DrivesTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty label="No test drives" />;
  return (
    <div className="rounded-xl border bg-card overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Customer</TableHead><TableHead>Phone</TableHead><TableHead>Vehicle</TableHead>
          <TableHead>Status</TableHead><TableHead>Preferred Date</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.customer_name || "—"}</TableCell>
              <TableCell>{r.phone_number || "—"}</TableCell>
              <TableCell>{r.vehicle_model || r.vehicle_interest || "—"}</TableCell>
              <TableCell>{statusBadge(r.status)}</TableCell>
              <TableCell>{r.preferred_date ? new Date(r.preferred_date).toLocaleDateString() : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PartsTable({ rows }: { rows: any[] }) {
  if (!rows.length) return <Empty label="No parts usage recorded" />;
  return (
    <div className="rounded-xl border bg-card overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Booking</TableHead><TableHead>Vehicle</TableHead><TableHead>Parts</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.customer_name || "—"}</TableCell>
              <TableCell>{r.vehicle_model || "—"}</TableCell>
              <TableCell className="text-xs">
                {(r.parts_used as any[]).map((p, i) => (
                  <div key={i}>{p.name || p.part_name} × {p.quantity || p.qty || 1}</div>
                ))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function InvoicesTable({ rows, fallback }: { rows: any[]; fallback: any[] }) {
  const data = rows.length ? rows : fallback;
  if (!data.length) return <Empty label="No invoices" />;
  return (
    <div className="rounded-xl border bg-card overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Reference</TableHead><TableHead>Amount</TableHead><TableHead>Date</TableHead><TableHead>Link</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {data.map((r) => (
            <TableRow key={r.id}>
              <TableCell>{r.invoice_number || r.customer_name || r.id.slice(0,8)}</TableCell>
              <TableCell>{r.amount ?? r.estimate_amount ?? "—"}</TableCell>
              <TableCell>{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</TableCell>
              <TableCell>
                {r.invoice_url || r.file_url ? (
                  <a className="text-primary underline text-xs" href={r.invoice_url || r.file_url} target="_blank" rel="noopener">Open</a>
                ) : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">{label}</div>;
}

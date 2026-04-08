import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Zap, History, Loader2, Activity } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  trigger_table: string;
  conditions: Record<string, string>;
  actions: Array<{ type: string; to?: string }>;
  is_active: boolean;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
}

interface AutomationLog {
  id: string;
  rule_id: string;
  trigger_event: string;
  trigger_data: Record<string, unknown>;
  actions_executed: unknown;
  status: string;
  execution_time_ms: number | null;
  created_at: string;
}

const TRIGGER_OPTIONS = [
  { table: "service_bookings", event: "service_bookings_created", label: "New Service Booking" },
  { table: "service_bookings", event: "service_bookings_updated", label: "Service Booking Updated" },
  { table: "leads", event: "leads_created", label: "New Lead" },
  { table: "leads", event: "leads_updated", label: "Lead Updated" },
  { table: "test_drive_bookings", event: "test_drive_bookings_created", label: "New Test Drive" },
  { table: "customers", event: "customers_created", label: "New Customer" },
  { table: "campaigns", event: "campaigns_updated", label: "Campaign Updated" },
];

const ACTION_OPTIONS = [
  { type: "notify", label: "Send Notification" },
];

export default function AutomationsPage() {
  const { tenantId } = useAuth();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    trigger: TRIGGER_OPTIONS[0].event,
    conditionField: "",
    conditionValue: "",
    actionType: "notify",
    notifyTo: "all",
  });

  const fetchData = async () => {
    if (!tenantId) return;
    const [rulesRes, logsRes] = await Promise.all([
      supabase.from("automation_rules").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
      supabase.from("automation_logs").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(50),
    ]);
    if (rulesRes.data) setRules(rulesRes.data as unknown as AutomationRule[]);
    if (logsRes.data) setLogs(logsRes.data as unknown as AutomationLog[]);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [tenantId]);

  const handleCreate = async () => {
    if (!tenantId || !form.name.trim()) { toast.error("Name is required"); return; }
    const trigger = TRIGGER_OPTIONS.find((t) => t.event === form.trigger)!;
    const conditions: Record<string, string> = {};
    if (form.conditionField.trim() && form.conditionValue.trim()) {
      conditions[form.conditionField.trim()] = form.conditionValue.trim();
    }
    setSaving(true);
    const { error } = await supabase.from("automation_rules").insert({
      tenant_id: tenantId,
      name: form.name.trim(),
      description: form.description.trim() || null,
      trigger_event: trigger.event,
      trigger_table: trigger.table,
      conditions,
      actions: [{ type: form.actionType, to: form.notifyTo }],
      is_active: true,
    } as any);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Automation created"); setOpen(false); fetchData(); }
  };

  const toggleRule = async (id: string, active: boolean) => {
    const { error } = await supabase.from("automation_rules").update({ is_active: active }).eq("id", id);
    if (error) toast.error(error.message);
    else fetchData();
  };

  const deleteRule = async (id: string) => {
    const { error } = await supabase.from("automation_rules").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Rule deleted"); fetchData(); }
  };

  const statusColor = (s: string) =>
    s === "success" ? "bg-success/10 text-success" : s === "skipped" ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive";

  return (
    <>
      <TopBar title="Automations" />
      <div className="flex-1 overflow-y-auto p-6">
        <Tabs defaultValue="rules">
          <div className="flex justify-between items-center mb-6">
            <TabsList>
              <TabsTrigger value="rules" className="gap-2"><Zap className="w-4 h-4" />Rules</TabsTrigger>
              <TabsTrigger value="logs" className="gap-2"><History className="w-4 h-4" />Execution Log</TabsTrigger>
            </TabsList>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button><Plus className="w-4 h-4" /> New Automation</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Create Automation Rule</DialogTitle></DialogHeader>
                <div className="space-y-4 pt-2">
                  <div className="space-y-2">
                    <Label>Rule Name</Label>
                    <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Notify on new booking" />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="What this rule does..." rows={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>Trigger Event</Label>
                    <Select value={form.trigger} onValueChange={(v) => setForm({ ...form, trigger: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TRIGGER_OPTIONS.map((t) => (
                          <SelectItem key={t.event} value={t.event}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Condition Field (optional)</Label>
                      <Input value={form.conditionField} onChange={(e) => setForm({ ...form, conditionField: e.target.value })} placeholder="status" />
                    </div>
                    <div className="space-y-2">
                      <Label>Condition Value</Label>
                      <Input value={form.conditionValue} onChange={(e) => setForm({ ...form, conditionValue: e.target.value })} placeholder="pending" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Action</Label>
                    <Select value={form.actionType} onValueChange={(v) => setForm({ ...form, actionType: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ACTION_OPTIONS.map((a) => (
                          <SelectItem key={a.type} value={a.type}>{a.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Notify</Label>
                    <Select value={form.notifyTo} onValueChange={(v) => setForm({ ...form, notifyTo: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Team Members</SelectItem>
                        <SelectItem value="tenant_admin">Admins Only</SelectItem>
                        <SelectItem value="staff">Staff Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button className="w-full" onClick={handleCreate} disabled={saving}>
                    {saving && <Loader2 className="w-4 h-4 animate-spin" />} Create Rule
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <TabsContent value="rules">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : rules.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Zap className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No automation rules yet. Create one to get started.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {rules.map((rule) => (
                  <div key={rule.id} className="glass-card rounded-xl p-5 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Zap className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground truncate">{rule.name}</p>
                        <Badge variant="outline" className="text-xs">
                          {TRIGGER_OPTIONS.find((t) => t.event === rule.trigger_event)?.label || rule.trigger_event}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {rule.execution_count} executions
                        {rule.last_executed_at && ` · Last: ${format(new Date(rule.last_executed_at), "MMM d, HH:mm")}`}
                      </p>
                    </div>
                    <Switch checked={rule.is_active} onCheckedChange={(v) => toggleRule(rule.id, v)} />
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deleteRule(rule.id)}>Delete</Button>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="logs">
            {logs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Activity className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No executions yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <div key={log.id} className="glass-card rounded-lg p-4 flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(log.status)}`}>{log.status}</span>
                    <span className="text-sm text-foreground font-medium">{log.trigger_event}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {log.execution_time_ms != null && `${log.execution_time_ms}ms · `}
                      {format(new Date(log.created_at), "MMM d, HH:mm:ss")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

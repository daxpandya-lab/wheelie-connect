import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Wrench, MessageCircleOff, Star, History, Save, Zap, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

// ---------- Settings shape ----------
type Settings = {
  predictive_service_reminder?: {
    enabled?: boolean;
    interval_months?: 3 | 6 | 12;
    mileage_tracking?: boolean;
  };
  chat_drop_off_recovery?: {
    enabled?: boolean;
    timeout_minutes?: 15 | 30 | 60 | 120;
  };
  post_service_feedback?: {
    enabled?: boolean;
    delay_hours?: 24 | 48;
  };
  google_review_url?: string | null;
};

const DEFAULTS: Required<Pick<Settings, "predictive_service_reminder" | "chat_drop_off_recovery" | "post_service_feedback">> = {
  predictive_service_reminder: { enabled: true, interval_months: 6, mileage_tracking: false },
  chat_drop_off_recovery: { enabled: true, timeout_minutes: 30 },
  post_service_feedback: { enabled: true, delay_hours: 24 },
};

export default function AutomationsPage() {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<Settings>({});
  const [reviewUrl, setReviewUrl] = useState("");
  const [logs, setLogs] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data: t } = await supabase
      .from("tenants").select("settings").eq("id", tenantId).maybeSingle();
    const s = ((t?.settings as any) || {}) as Settings;
    setSettings({
      predictive_service_reminder: { ...DEFAULTS.predictive_service_reminder, ...(s.predictive_service_reminder || {}) },
      chat_drop_off_recovery: { ...DEFAULTS.chat_drop_off_recovery, ...(s.chat_drop_off_recovery || {}) },
      post_service_feedback: { ...DEFAULTS.post_service_feedback, ...(s.post_service_feedback || {}) },
      google_review_url: s.google_review_url || "",
    });
    setReviewUrl(s.google_review_url || "");

    const { data: l } = await supabase
      .from("automation_logs").select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(30);
    setLogs(l || []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const persist = async (patch: Settings) => {
    if (!tenantId) return;
    setSaving(true);
    // Merge under existing settings to avoid wiping other config (working_hours, holidays, etc).
    const { data: t } = await supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
    const current = ((t?.settings as any) || {}) as Record<string, any>;
    const merged = { ...current, ...patch };
    const { error } = await supabase.from("tenants").update({ settings: merged } as any).eq("id", tenantId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Automation settings saved");
    setSettings((s) => ({ ...s, ...patch }));
  };

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
  };

  if (loading) {
    return (
      <>
        <TopBar title="Automations" />
        <div className="flex-1 flex justify-center items-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      </>
    );
  }

  const p = settings.predictive_service_reminder!;
  const c = settings.chat_drop_off_recovery!;
  const f = settings.post_service_feedback!;

  return (
    <>
      <TopBar title="Automations — Control Room" />
      <div className="flex-1 overflow-y-auto p-6">
        <Tabs defaultValue="control">
          <TabsList className="mb-6">
            <TabsTrigger value="control" className="gap-2"><Zap className="w-4 h-4" /> Control Room</TabsTrigger>
            <TabsTrigger value="logs" className="gap-2"><History className="w-4 h-4" /> Execution Log</TabsTrigger>
          </TabsList>

          <TabsContent value="control" className="space-y-6">
            {/* ---------- Pillar 1: Service & Retention Reminders ---------- */}
            <Card className="border-l-4 border-l-primary">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Wrench className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle>Service & Retention Reminders</CardTitle>
                    <CardDescription>
                      When a job card closes, schedule a periodic-service WhatsApp reminder to bring the customer back.
                    </CardDescription>
                  </div>
                </div>
                <Switch
                  checked={!!p.enabled}
                  onCheckedChange={(v) => persist({ predictive_service_reminder: { ...p, enabled: v } })}
                />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Send Interval</Label>
                    <Select
                      value={String(p.interval_months ?? 6)}
                      onValueChange={(v) => update("predictive_service_reminder", { ...p, interval_months: Number(v) as 3 | 6 | 12 })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3">3 Months</SelectItem>
                        <SelectItem value="6">6 Months</SelectItem>
                        <SelectItem value="12">1 Year</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={!!p.mileage_tracking}
                        onCheckedChange={(v) => update("predictive_service_reminder", { ...p, mileage_tracking: !!v })}
                      />
                      <span className="text-sm">Predictive Mileage Tracking (10,000 KM)</span>
                    </label>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => persist({ predictive_service_reminder: p })} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />} Save
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Triggered by completed service bookings. Dispatched by the <code>predictive-service-reminders</code> background job using the customer's name and vehicle data with a booking link.
                </p>
              </CardContent>
            </Card>

            {/* ---------- Pillar 2: Chat Drop-off Recovery ---------- */}
            <Card className="border-l-4 border-l-warning">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center shrink-0">
                    <MessageCircleOff className="w-5 h-5 text-warning" />
                  </div>
                  <div>
                    <CardTitle>Chat Drop-off Recovery</CardTitle>
                    <CardDescription>
                      If a customer halts mid-booking, wait the timeout, then fire WhatsApp recovery chips.
                    </CardDescription>
                  </div>
                </div>
                <Switch
                  checked={!!c.enabled}
                  onCheckedChange={(v) => persist({ chat_drop_off_recovery: { ...c, enabled: v } })}
                />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Timeout Interval Delay</Label>
                    <Select
                      value={String(c.timeout_minutes ?? 30)}
                      onValueChange={(v) => update("chat_drop_off_recovery", { ...c, timeout_minutes: Number(v) as 15 | 30 | 60 | 120 })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 Minutes</SelectItem>
                        <SelectItem value="30">30 Minutes</SelectItem>
                        <SelectItem value="60">1 Hour</SelectItem>
                        <SelectItem value="120">2 Hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end text-xs text-muted-foreground">
                    <p>Recovery message offers: 📅 Resume Booking / ❌ Cancel &amp; End</p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => persist({ chat_drop_off_recovery: c })} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />} Save
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Dispatched by the <code>chat-dropoff-recovery</code> background job, which scans incomplete chat sessions older than the timeout and sends the WhatsApp recovery prompt.
                </p>
              </CardContent>
            </Card>

            {/* ---------- Pillar 3: Post-Service Feedback ---------- */}
            <Card className="border-l-4 border-l-success">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center shrink-0">
                    <Star className="w-5 h-5 text-success" />
                  </div>
                  <div>
                    <CardTitle>Post-Service Feedback & Google Review Engine</CardTitle>
                    <CardDescription>
                      Ask for a 1–5 rating after delivery. 4/5★ replies are auto-routed to your Google Review listing.
                    </CardDescription>
                  </div>
                </div>
                <Switch
                  checked={!!f.enabled}
                  onCheckedChange={(v) => persist({ post_service_feedback: { ...f, enabled: v } })}
                />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Follow-up Delay</Label>
                    <Select
                      value={String(f.delay_hours ?? 24)}
                      onValueChange={(v) => update("post_service_feedback", { ...f, delay_hours: Number(v) as 24 | 48 })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24">24 Hours</SelectItem>
                        <SelectItem value="48">48 Hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Google Review URL (for high ratings)</Label>
                    <Input
                      value={reviewUrl}
                      onChange={(e) => setReviewUrl(e.target.value)}
                      onBlur={() => reviewUrl !== (settings.google_review_url || "") && persist({ google_review_url: reviewUrl.trim() || null })}
                      placeholder="https://g.page/r/..."
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => persist({ post_service_feedback: f, google_review_url: reviewUrl.trim() || null })} disabled={saving}>
                    {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />} Save
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Dispatched by the <code>csat-followup</code> background job once a booking is marked Completed/Delivered. 4–5★ replies trigger an auto-reply with the Google Review link.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="logs">
            {logs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>No automation runs logged yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((l) => (
                  <div key={l.id} className="rounded-lg border bg-card p-3 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">{l.trigger_event}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(l.created_at), "PPpp")}</div>
                    </div>
                    <Badge variant="outline" className="capitalize">{l.status}</Badge>
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

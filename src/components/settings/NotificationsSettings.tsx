import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Save, CalendarClock, BellRing, Activity, MessageSquare, Radio } from "lucide-react";
import { toast } from "sonner";

type PreCheckin = {
  enabled?: boolean;
  lead_time_hours?: 12 | 24 | 48 | 72;
  allow_cancellations?: boolean;
};

const DEFAULT_PRE: Required<PreCheckin> = {
  enabled: true,
  lead_time_hours: 24,
  allow_cancellations: true,
};

function DealerNotifications() {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pi, setPi] = useState<Required<PreCheckin>>(DEFAULT_PRE);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
    const s = (data?.settings as any) || {};
    setPi({ ...DEFAULT_PRE, ...(s.pre_appointment_checkin || {}) });
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const persist = async (patch: Partial<PreCheckin>) => {
    if (!tenantId) return;
    setSaving(true);
    const next = { ...pi, ...patch };
    const { data: t } = await supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
    const current = ((t?.settings as any) || {}) as Record<string, any>;
    const merged = { ...current, pre_appointment_checkin: next };
    const { error } = await supabase.from("tenants").update({ settings: merged } as any).eq("id", tenantId);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setPi(next);
    toast.success("Notification preference saved");
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card className="border-l-4 border-l-accent">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
              <CalendarClock className="w-5 h-5 text-accent-foreground" />
            </div>
            <div>
              <CardTitle>Pre-Appointment Intake & Reminders</CardTitle>
              <CardDescription>Master control for the WhatsApp check-in reminder bot.</CardDescription>
            </div>
          </div>
          <Switch checked={!!pi.enabled} onCheckedChange={(v) => persist({ enabled: v })} />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={`space-y-4 ${pi.enabled ? "" : "opacity-50 pointer-events-none"}`}>
            <div className="space-y-2 max-w-sm">
              <Label>Send Reminder Lead Time</Label>
              <Select
                value={String(pi.lead_time_hours ?? 24)}
                onValueChange={(v) => persist({ lead_time_hours: Number(v) as 12 | 24 | 48 | 72 })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="12">12 Hours Before</SelectItem>
                  <SelectItem value="24">24 Hours Before</SelectItem>
                  <SelectItem value="48">48 Hours Before</SelectItem>
                  <SelectItem value="72">3 Days Before</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
              <div>
                <Label className="text-sm font-medium">Allow Bot Cancellations & Reconfirmations</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When off, the reminder shows only 📝 Comments and 📸 Photos — the ❌ Cancel chip is removed.
                </p>
              </div>
              <Switch
                checked={pi.allow_cancellations !== false}
                onCheckedChange={(v) => persist({ allow_cancellations: v })}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="sm" onClick={() => persist({})} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Save className="w-4 h-4 mr-1" />} Save Preferences
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Advanced automation controls (drop-off recovery, feedback, service reminders) remain configurable inside the Automations Control Room.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SuperAdminNotifications() {
  const [loading, setLoading] = useState(true);
  const [totals, setTotals] = useState({ total: 0, last24: 0, sent: 0, failed: 0 });
  const [byChannel, setByChannel] = useState<Record<string, number>>({});
  const [waStatus, setWaStatus] = useState<{ connected: number; idle: number; timeout: number; total: number }>({ connected: 0, idle: 0, timeout: 0, total: 0 });
  const [recentFailures, setRecentFailures] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [{ data: logs, count }, { data: last24 }, { data: waSessions }, { data: fails }] = await Promise.all([
        supabase.from("outbound_communication_logs").select("status, channel", { count: "exact" }).limit(1000),
        supabase.from("outbound_communication_logs").select("id").gte("created_at", since24),
        supabase.from("whatsapp_sessions").select("status, last_webhook_at"),
        supabase.from("outbound_communication_logs")
          .select("id, tenant_id, automation_type, channel, error_message, created_at")
          .eq("status", "failed").order("created_at", { ascending: false }).limit(5),
      ]);

      const rows = logs || [];
      const chan: Record<string, number> = {};
      let sent = 0, failed = 0;
      rows.forEach((r: any) => {
        chan[r.channel || "unknown"] = (chan[r.channel || "unknown"] || 0) + 1;
        if (r.status === "sent" || r.status === "success") sent++;
        if (r.status === "failed" || r.status === "error") failed++;
      });
      setByChannel(chan);
      setTotals({ total: count ?? rows.length, last24: (last24 || []).length, sent, failed });

      const sess = waSessions || [];
      const now = Date.now();
      const staleMs = 60 * 60 * 1000;
      let connected = 0, idle = 0, timeout = 0;
      sess.forEach((s: any) => {
        if (s.status === "connected") connected++;
        else if (s.last_webhook_at && now - new Date(s.last_webhook_at).getTime() > staleMs) timeout++;
        else idle++;
      });
      setWaStatus({ connected, idle, timeout, total: sess.length });
      setRecentFailures(fails || []);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricTile icon={MessageSquare} label="Outbound (all time)" value={totals.total} tone="primary" />
        <MetricTile icon={Activity} label="Last 24 Hours" value={totals.last24} tone="accent" />
        <MetricTile icon={BellRing} label="Delivered" value={totals.sent} tone="success" />
        <MetricTile icon={Radio} label="Failed" value={totals.failed} tone="destructive" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Global WhatsApp Gateway Connectivity</CardTitle>
          <CardDescription>Live status across all registered tenants (based on last webhook timestamp).</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatusPill label="Connected" value={waStatus.connected} tone="success" />
          <StatusPill label="Idle" value={waStatus.idle} tone="muted" />
          <StatusPill label="Timed Out" value={waStatus.timeout} tone="warning" />
          <StatusPill label="Total Tenants" value={waStatus.total} tone="primary" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Outbound Volume by Channel</CardTitle>
          <CardDescription>Message dispatch counts grouped by transport (WhatsApp, email, etc.).</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {Object.keys(byChannel).length === 0 ? (
            <p className="text-sm text-muted-foreground">No outbound traffic captured yet.</p>
          ) : Object.entries(byChannel).map(([ch, n]) => (
            <Badge key={ch} variant="secondary" className="font-mono text-xs">{ch}: {n}</Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Edge Function Failures</CardTitle>
          <CardDescription>Last 5 outbound automation errors across the platform.</CardDescription>
        </CardHeader>
        <CardContent>
          {recentFailures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No failures logged — all outbound edges are healthy.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {recentFailures.map((f) => (
                <li key={f.id} className="rounded-md border p-2 bg-muted/30">
                  <div className="flex justify-between gap-4">
                    <span className="font-medium text-foreground">{f.automation_type || "unknown"}</span>
                    <span className="text-muted-foreground">{new Date(f.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-destructive mt-1 truncate">{f.error_message || "Unknown error"}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricTile({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: string }) {
  return (
    <div className={`rounded-xl border p-4 bg-${tone}/5`}>
      <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
        <Icon className="w-4 h-4" /> {label}
      </div>
      <p className="text-2xl font-semibold text-foreground">{value.toLocaleString()}</p>
    </div>
  );
}

function StatusPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  const toneMap: Record<string, string> = {
    success: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
    warning: "text-amber-600 dark:text-amber-400 bg-amber-500/10",
    muted: "text-muted-foreground bg-muted",
    primary: "text-primary bg-primary/10",
  };
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <span className={`inline-flex px-2 py-0.5 rounded-full text-sm font-semibold ${toneMap[tone] || ""}`}>
        {value}
      </span>
    </div>
  );
}

export default function NotificationsSettings() {
  const { isSuperAdmin, profile, user } = useAuth();
  const isMasterAdmin = useMemo(
    () => isSuperAdmin && `${profile?.full_name ?? ""} ${user?.email ?? ""}`.toLowerCase().includes("daxesh"),
    [isSuperAdmin, profile, user],
  );
  return isMasterAdmin ? <SuperAdminNotifications /> : <DealerNotifications />;
}

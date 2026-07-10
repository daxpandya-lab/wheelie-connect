import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Activity, RefreshCcw, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

interface HealthRow {
  provider: string;
  status: string;
  version: string | null;
  last_success_at: string | null;
  last_check_at: string;
  error_message: string | null;
  action_required: boolean;
  metadata: any;
}

const STATUS_MAP: Record<string, { emoji: string; label: string; tone: string }> = {
  operational:      { emoji: "🟢", label: "Operational", tone: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" },
  degraded:         { emoji: "🟠", label: "Degraded", tone: "text-amber-600 bg-amber-500/10 border-amber-500/30" },
  action_required:  { emoji: "🟡", label: "Action Required: Provider Update Detected", tone: "text-amber-700 bg-amber-500/10 border-amber-500/30" },
  auth_failure:     { emoji: "🔴", label: "Authentication Failure", tone: "text-red-600 bg-red-500/10 border-red-500/30" },
  unreachable:      { emoji: "🔴", label: "Unreachable", tone: "text-red-600 bg-red-500/10 border-red-500/30" },
  unknown:          { emoji: "⚪", label: "Not yet checked", tone: "text-muted-foreground bg-muted border-border" },
};

export default function GatewayHealthWidget() {
  const { tenantId } = useAuth();
  const [row, setRow] = useState<HealthRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [pinging, setPinging] = useState(false);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase
      .from("gateway_health_status")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("last_check_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRow((data as any) || null);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);

  const runHeartbeat = async () => {
    if (!tenantId) return;
    setPinging(true);
    try {
      const { data, error } = await supabase.functions.invoke("gateway-heartbeat", {
        body: {}, // service uses query param; but invoke passes body — we'll fall back to bulk
      });
      if (error) throw error;
      toast.success("Heartbeat ping complete");
      await load();
    } catch (e: any) {
      toast.error(e.message || "Heartbeat failed");
    } finally {
      setPinging(false);
    }
  };

  if (loading) {
    return (
      <Card><CardContent className="flex justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </CardContent></Card>
    );
  }

  const statusKey = row?.status || "unknown";
  const s = STATUS_MAP[statusKey] || STATUS_MAP.unknown;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div>
            <CardTitle>Gateway Health Monitor</CardTitle>
            <CardDescription>Live uptime & version tracking for the active WhatsApp gateway.</CardDescription>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={runHeartbeat} disabled={pinging}>
          {pinging ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
          <span className="ml-1">Ping now</span>
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`rounded-lg border p-4 ${s.tone}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">{s.emoji}</span>
              <span className="font-semibold">System Status: {s.label}</span>
            </div>
            {row?.provider && <Badge variant="secondary" className="uppercase text-[10px]">{row.provider}</Badge>}
          </div>
          {row?.error_message && (
            <p className="text-xs mt-2 opacity-90 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              {row.error_message}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <InfoTile label="API Version" value={row?.version || "—"} />
          <InfoTile label="Last Successful Ping" value={row?.last_success_at ? new Date(row.last_success_at).toLocaleString() : "Never"} />
          <InfoTile label="Last Check" value={row?.last_check_at ? new Date(row.last_check_at).toLocaleString() : "—"} />
        </div>

        {row?.action_required && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-800 dark:text-amber-300">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">Provider update detected.</p>
              <p className="opacity-90 mt-0.5">
                A mismatch or authentication failure was detected during the last heartbeat. Open the provider portal (Meta Developer Console or your Evolution instance) to reconcile credentials or update the API version.
              </p>
            </div>
          </div>
        )}

        {!row && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            No heartbeat recorded yet. The scheduled monitor runs every 60 minutes, or click "Ping now" to run immediately.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <p className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</p>
      <p className="text-sm font-medium text-foreground mt-1 truncate" title={value}>{value}</p>
    </div>
  );
}

import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { MessageSquare, Copy, Check, Loader2, ExternalLink, Wifi, WifiOff, QrCode, Unplug } from "lucide-react";
import { toast } from "sonner";
// ScanGoModal (Evolution QR flow) retired — Meta Cloud API is the sole gateway.

export default function WhatsAppConfig() {
  const { tenantId } = useAuth();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<"meta" | "evolution" | null>(null);
  const [copied, setCopied] = useState(false);
  const [flows, setFlows] = useState<Array<{ id: string; name: string; is_active: boolean }>>([]);
  const [activatingFlow, setActivatingFlow] = useState(false);
  const [provider, setProvider] = useState<"meta" | "evolution">("meta");
  const [scanOpen, setScanOpen] = useState(false);
  const [evolutionStatus, setEvolutionStatus] = useState<string>("disconnected");
  // Persisted-active gateway (nullable) — the tenant's currently live pipeline.
  // Drives the mutual-exclusion overlay + dynamic connection badge.
  const [activeGateway, setActiveGateway] = useState<"meta" | "evolution" | null>(null);
  const [form, setForm] = useState({
    phoneNumberId: "",
    wabaId: "",
    accessToken: "",
    evolutionUrl: "",
    evolutionApiKey: "",
    evolutionInstance: "",
  });

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || "";
  const webhookUrl = projectId
    ? `https://${projectId}.supabase.co/functions/v1/whatsapp-webhook`
    : "[Deploy to get webhook URL]";

  const activeFlowId = flows.find((f) => f.is_active)?.id || "";

  const fetchSession = async () => {
    if (!tenantId) { setLoading(false); return; }
    // Strict per-tenant fetch. maybeSingle() so a missing row (fresh dealer or
    // just-removed connection) resolves to null instead of throwing — otherwise
    // the badge could get stuck on stale local state.
    const [{ data: sessionData }, { data: flowsData }, { data: tenantRow }] = await Promise.all([
      supabase.from("whatsapp_sessions").select("*").eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("chatbot_flows").select("id, name, is_active").eq("tenant_id", tenantId).order("name"),
      supabase.from("tenants").select("whatsapp_config").eq("id", tenantId).maybeSingle(),
    ]);

    setSession(sessionData || null);
    const cfg = (tenantRow?.whatsapp_config as Record<string, any>) || {};
    const persisted: "meta" | "evolution" =
      (cfg.active_gateway === "meta" || cfg.active_gateway === "evolution")
        ? cfg.active_gateway
        : (cfg.provider === "evolution" ? "evolution" : "meta");
    setProvider(persisted);
    // A gateway is only "live" for THIS tenant when all three hold:
    //   (a) it is the persisted active gateway on the tenant row,
    //   (b) the tenant still has non-empty provider credentials, and
    //   (c) for Meta, whatsapp_sessions row is is_active with a phone_number_id.
    // This guarantees that when a dealer removes credentials, their badge flips
    // to "Not Connected" regardless of any other tenant's state.
    const metaHasCreds = !!(cfg.meta?.phone_number_id || sessionData?.phone_number_id);
    const metaSessionLive = !!(sessionData?.is_active && sessionData?.tenant_id === tenantId);
    const metaLive = cfg.active_gateway === "meta" && metaHasCreds && metaSessionLive;
    const evoLive = cfg.active_gateway === "evolution" && cfg.evolution?.status === "connected";
    setActiveGateway(metaLive ? "meta" : evoLive ? "evolution" : null);
    setEvolutionStatus(cfg.evolution?.status || "disconnected");
    setForm({
      phoneNumberId: sessionData?.phone_number_id || cfg.meta?.phone_number_id || "",
      wabaId: sessionData?.waba_id || cfg.meta?.waba_id || "",
      accessToken: "",
      evolutionUrl: cfg.evolution?.instance_url || "",
      evolutionApiKey: "",
      evolutionInstance: cfg.evolution?.instance_name || "",
    });
    if (flowsData) setFlows(flowsData);
    setLoading(false);
  };

  useEffect(() => { fetchSession(); }, [tenantId]);

  const handleSetActiveFlow = async (flowId: string) => {
    if (!tenantId) return;
    setActivatingFlow(true);
    // Deactivate all, then activate selected
    await supabase.from("chatbot_flows").update({ is_active: false }).eq("tenant_id", tenantId);
    const { error } = await supabase.from("chatbot_flows").update({ is_active: true }).eq("id", flowId);
    setActivatingFlow(false);
    if (error) toast.error(error.message);
    else { toast.success("Active flow updated"); fetchSession(); }
  };

  const handleSave = async () => {
    if (!tenantId) return;
    if (provider === "meta" && !form.phoneNumberId.trim()) {
      toast.error("Phone Number ID is required");
      return;
    }
    if (provider === "evolution" && (!form.evolutionUrl.trim() || !form.evolutionInstance.trim())) {
      toast.error("Evolution Instance URL and Instance Name are required");
      return;
    }
    setSaving(true);

    // Load existing config to merge
    const { data: tenant } = await supabase
      .from("tenants")
      .select("whatsapp_config")
      .eq("id", tenantId)
      .single();
    const existingConfig = (tenant?.whatsapp_config as Record<string, any>) || {};
    // EXCLUSIVE GATEWAY: only one provider block is active per tenant.
    // The inactive provider block is preserved as `*_archived` for audit but
    // removed from the live keys so downstream code cannot pick it up.
    const nextConfig: Record<string, any> = {
      ...existingConfig,
      provider,
      active_gateway: provider, // exclusive gateway marker consumed by badges + guards
      active_since: new Date().toISOString(),
    };

    if (provider === "meta") {
      nextConfig.meta = {
        ...(existingConfig.meta || {}),
        phone_number_id: form.phoneNumberId.trim(),
        waba_id: form.wabaId.trim() || null,
      };
      if (form.accessToken.trim()) {
        nextConfig.meta.access_token = form.accessToken.trim();
        nextConfig.access_token = form.accessToken.trim();
      }
      // Archive & disable Evolution so it cannot serve traffic
      if (existingConfig.evolution) {
        nextConfig.evolution_archived = { ...existingConfig.evolution, disabled_at: new Date().toISOString() };
      }
      delete nextConfig.evolution;

      const sessionData: any = {
        tenant_id: tenantId,
        phone_number_id: form.phoneNumberId.trim(),
        waba_id: form.wabaId.trim() || null,
        is_active: true,
      };
      if (session) {
        await supabase.from("whatsapp_sessions").update(sessionData).eq("id", session.id);
      } else {
        await supabase.from("whatsapp_sessions").insert(sessionData);
      }
    } else {
      nextConfig.evolution = {
        ...(existingConfig.evolution || {}),
        instance_url: form.evolutionUrl.trim().replace(/\/+$/, ""),
        instance_name: form.evolutionInstance.trim(),
      };
      if (form.evolutionApiKey.trim()) {
        nextConfig.evolution.api_key = form.evolutionApiKey.trim();
      }
      // Archive & disable Meta so it cannot serve traffic
      if (existingConfig.meta || existingConfig.access_token) {
        nextConfig.meta_archived = { ...(existingConfig.meta || {}), disabled_at: new Date().toISOString() };
      }
      delete nextConfig.meta;
      delete nextConfig.access_token;
      // Deactivate Meta session so webhooks stop routing there
      if (session) {
        await supabase.from("whatsapp_sessions").update({ is_active: false }).eq("id", session.id);
      }
    }

    await supabase
      .from("tenants")
      .update({ whatsapp_config: nextConfig })
      .eq("id", tenantId);

    setSaving(false);
    toast.success("WhatsApp configuration saved!");
    fetchSession();
  };

  /**
   * Remove Connection — hard reset for the specified gateway.
   * Meta: purges keys/tokens from tenant config, deactivates whatsapp_sessions row.
   * Evolution: server-side logs out + deletes the instance from the self-hosted
   * Evolution server using the platform master key, then clears the tenant
   * config. Either path resets active_gateway=null so the opposite provider's
   * form immediately un-blurs on refetch.
   */
  const handleRemove = async (which: "meta" | "evolution") => {
    if (!tenantId) return;
    setRemoving(which);
    try {
      const { data, error } = await supabase.functions.invoke("evolution-connect", {
        body: { action: which === "meta" ? "remove_meta" : "remove_evolution", tenant_id: tenantId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(which === "meta" ? "Meta API connection removed" : "Evolution instance removed");
      // Reset local form so the cleared provider shows empty fields immediately
      setForm((f) => which === "meta"
        ? { ...f, phoneNumberId: "", wabaId: "", accessToken: "" }
        : { ...f, evolutionUrl: "", evolutionApiKey: "", evolutionInstance: "" });
      await fetchSession();
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove connection");
    } finally {
      setRemoving(null);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    toast.success("Webhook URL copied");
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#25D366]/10 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-[#25D366]" />
              </div>
              <div>
                <CardTitle className="text-base">WhatsApp Business API</CardTitle>
                <CardDescription>Connect your WhatsApp Business Account</CardDescription>
              </div>
            </div>
            {activeGateway === "meta" ? (
              <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600 text-white">
                <Wifi className="w-3 h-3" /> WhatsApp Meta API Connected
              </Badge>
            ) : activeGateway === "evolution" ? (
              <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600 text-white">
                <Wifi className="w-3 h-3" /> Evolution WhatsApp Api Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <WifiOff className="w-3 h-3" /> Not Connected
              </Badge>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Active Flow Selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Active Chatbot Flow</CardTitle>
          <CardDescription>
            Select which flow your customers will interact with on WhatsApp.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {flows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No flows yet. Create one in the Flow Builder first.
            </p>
          ) : (
            <Select value={activeFlowId} onValueChange={handleSetActiveFlow} disabled={activatingFlow}>
              <SelectTrigger>
                <SelectValue placeholder="Select active flow" />
              </SelectTrigger>
              <SelectContent>
                {flows.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name} {f.is_active && "✓"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {activatingFlow && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Updating active flow...
            </p>
          )}
        </CardContent>
      </Card>

      {/* Webhook URL */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Webhook URL</CardTitle>
          <CardDescription>
            Set this URL in your Meta Developer Console under WhatsApp &gt; Configuration &gt; Webhook URL
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input value={webhookUrl} readOnly className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={copyWebhookUrl}>
              {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
          {session?.verify_token && (
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground">Verify Token</Label>
              <div className="flex gap-2 mt-1">
                <Input value={session.verify_token} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => {
                  navigator.clipboard.writeText(session.verify_token);
                  toast.success("Verify token copied");
                }}>
                  <Copy className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>



      {/* WhatsApp Gateway — Meta Cloud API */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">WhatsApp Gateway (Meta Cloud API)</CardTitle>
          <CardDescription>
            This dealership sends and receives WhatsApp messages via the Official Meta Cloud API.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeGateway === "evolution" && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              Your previous Evolution connection is being retired. Remove it below and enter your Meta credentials to continue.
            </div>
          )}

          <fieldset className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Get these values from your{" "}
              <a href="https://developers.facebook.com" target="_blank" rel="noopener" className="text-primary hover:underline inline-flex items-center gap-1">
                Meta Developer Console <ExternalLink className="w-3 h-3" />
              </a>
            </p>
            <div className="space-y-2">
              <Label>Phone Number ID</Label>
              <Input
                value={form.phoneNumberId}
                onChange={(e) => setForm({ ...form, phoneNumberId: e.target.value })}
                placeholder="e.g., 123456789012345"
              />
            </div>
            <div className="space-y-2">
              <Label>WhatsApp Business Account ID (optional)</Label>
              <Input
                value={form.wabaId}
                onChange={(e) => setForm({ ...form, wabaId: e.target.value })}
                placeholder="e.g., 987654321098765"
              />
            </div>
            <div className="space-y-2">
              <Label>Permanent Access Token (optional)</Label>
              <Input
                type="password"
                value={form.accessToken}
                onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                placeholder={session ? "••••••••• (saved, enter new to override platform token)" : "Leave blank to use platform-managed token"}
              />
              <p className="text-[11px] text-muted-foreground">
                Leave blank to inherit the platform's managed permanent token. Only override if you're using your own Meta app.
              </p>
            </div>
          </fieldset>


          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Configuration
          </Button>

          {/* Remove Connection — only for the currently active gateway. Isolated
              from user session logout: purges provider config + Evolution instance. */}
          {activeGateway && activeGateway === provider && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2 mt-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-destructive flex items-center gap-1.5">
                    <Unplug className="w-4 h-4" />
                    {activeGateway === "meta" ? "Remove Meta API Connection" : "Disconnect Evolution Instance"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {activeGateway === "meta"
                      ? "Clears stored phone number IDs, WABA IDs and access tokens from this dealership. The opposite gateway becomes selectable again."
                      : "Logs the device out of WhatsApp, deletes the instance from the Evolution server, and frees the Meta API panel."}
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={!!removing}>
                      {removing === activeGateway ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4 mr-1" />}
                      Remove Connection
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {activeGateway === "meta" ? "Remove Meta API connection?" : "Disconnect Evolution instance?"}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {activeGateway === "meta"
                          ? "All stored Meta credentials (phone number ID, WABA ID, access token) will be cleared for this dealership. Incoming Meta webhooks will stop routing here until you reconnect."
                          : "The linked WhatsApp device will be logged out and the instance memory cleared from the Evolution server. You'll need to scan a new QR to reconnect."}
                        <br /><br />
                        This does not sign you out of DealerDoodle.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleRemove(activeGateway)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Yes, remove connection
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )}
        </CardContent>
      </Card>


      {/* Evolution "Scan & Go" retired — Meta Cloud API is now the sole gateway. */}


      {/* Last Activity */}
      {session?.last_webhook_at && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">
              Last webhook received: {new Date(session.last_webhook_at).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

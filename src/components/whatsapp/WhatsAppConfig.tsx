import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { MessageSquare, Copy, Check, Loader2, ExternalLink, Wifi, WifiOff, Unplug } from "lucide-react";
import { toast } from "sonner";

export default function WhatsAppConfig() {
  const { tenantId } = useAuth();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flows, setFlows] = useState<Array<{ id: string; name: string; is_active: boolean }>>([]);
  const [activatingFlow, setActivatingFlow] = useState(false);

  // Meta Cloud API is the sole gateway. `metaConnected` reflects THIS tenant's
  // credentials + active session only, so removing credentials flips only the
  // current dealer's badge to "Not Connected".
  const [metaConnected, setMetaConnected] = useState(false);
  const [form, setForm] = useState({
    phoneNumberId: "",
    wabaId: "",
    accessToken: "",
  });

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || "";
  const webhookUrl = projectId
    ? `https://${projectId}.supabase.co/functions/v1/whatsapp-webhook`
    : "[Deploy to get webhook URL]";

  const activeFlowId = flows.find((f) => f.is_active)?.id || "";

  const fetchSession = async () => {
    if (!tenantId) { setLoading(false); return; }
    const [{ data: sessionData }, { data: flowsData }, { data: tenantRow }] = await Promise.all([
      supabase.from("whatsapp_sessions").select("*").eq("tenant_id", tenantId).maybeSingle(),
      supabase.from("chatbot_flows").select("id, name, is_active").eq("tenant_id", tenantId).order("name"),
      supabase.from("tenants").select("whatsapp_config").eq("id", tenantId).maybeSingle(),
    ]);

    setSession(sessionData || null);
    const cfg = (tenantRow?.whatsapp_config as Record<string, any>) || {};

    const metaHasCreds = !!(cfg.meta?.phone_number_id || sessionData?.phone_number_id);
    const metaSessionLive = !!(sessionData?.is_active && sessionData?.tenant_id === tenantId);
    setMetaConnected(metaHasCreds && metaSessionLive);

    setForm({
      phoneNumberId: sessionData?.phone_number_id || cfg.meta?.phone_number_id || "",
      wabaId: sessionData?.waba_id || cfg.meta?.waba_id || "",
      accessToken: "",
    });
    if (flowsData) setFlows(flowsData);
    setLoading(false);
  };

  useEffect(() => { fetchSession(); }, [tenantId]);

  const handleSetActiveFlow = async (flowId: string) => {
    if (!tenantId) return;
    setActivatingFlow(true);
    await supabase.from("chatbot_flows").update({ is_active: false }).eq("tenant_id", tenantId);
    const { error } = await supabase.from("chatbot_flows").update({ is_active: true }).eq("id", flowId);
    setActivatingFlow(false);
    if (error) toast.error(error.message);
    else { toast.success("Active flow updated"); fetchSession(); }
  };

  const handleSave = async () => {
    if (!tenantId) return;
    if (!form.phoneNumberId.trim()) {
      toast.error("Phone Number ID is required");
      return;
    }
    setSaving(true);

    const { data: tenant } = await supabase
      .from("tenants")
      .select("whatsapp_config")
      .eq("id", tenantId)
      .single();
    const existingConfig = (tenant?.whatsapp_config as Record<string, any>) || {};
    const nextConfig: Record<string, any> = {
      ...existingConfig,
      provider: "meta",
      active_gateway: "meta",
      active_since: new Date().toISOString(),
      meta: {
        ...(existingConfig.meta || {}),
        phone_number_id: form.phoneNumberId.trim(),
        waba_id: form.wabaId.trim() || null,
      },
    };
    if (form.accessToken.trim()) {
      nextConfig.meta.access_token = form.accessToken.trim();
      nextConfig.access_token = form.accessToken.trim();
    }

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

    await supabase
      .from("tenants")
      .update({ whatsapp_config: nextConfig })
      .eq("id", tenantId);

    setSaving(false);
    toast.success("WhatsApp configuration saved!");
    fetchSession();
  };

  /**
   * Remove Meta Connection — purges Meta credentials from the tenant config
   * and deactivates the whatsapp_sessions row so incoming webhooks no longer
   * route to this dealership until reconnected. Does NOT sign the user out.
   */
  const handleRemove = async () => {
    if (!tenantId) return;
    setRemoving(true);
    try {
      const { data: tenant } = await supabase
        .from("tenants").select("whatsapp_config").eq("id", tenantId).single();
      const existingConfig = (tenant?.whatsapp_config as Record<string, any>) || {};
      const nextConfig: Record<string, any> = { ...existingConfig };
      if (existingConfig.meta || existingConfig.access_token) {
        nextConfig.meta_archived = { ...(existingConfig.meta || {}), disabled_at: new Date().toISOString() };
      }
      delete nextConfig.meta;
      delete nextConfig.access_token;
      nextConfig.active_gateway = null;
      nextConfig.provider = null;

      await supabase.from("tenants").update({ whatsapp_config: nextConfig }).eq("id", tenantId);
      if (session) {
        await supabase.from("whatsapp_sessions").update({ is_active: false }).eq("id", session.id);
      }

      toast.success("Meta API connection removed");
      setForm({ phoneNumberId: "", wabaId: "", accessToken: "" });
      await fetchSession();
    } catch (e: any) {
      toast.error(e?.message || "Failed to remove connection");
    } finally {
      setRemoving(false);
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
            {metaConnected ? (
              <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600 text-white">
                <Wifi className="w-3 h-3" /> WhatsApp Meta API Connected
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

          {/* Remove Connection — Meta only. Isolated from user session logout. */}
          {metaConnected && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2 mt-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-destructive flex items-center gap-1.5">
                    <Unplug className="w-4 h-4" />
                    Remove Meta API Connection
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Clears stored phone number IDs, WABA IDs and access tokens from this dealership. Incoming Meta webhooks will stop routing here until you reconnect.
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={removing}>
                      {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4 mr-1" />}
                      Remove Connection
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove Meta API connection?</AlertDialogTitle>
                      <AlertDialogDescription>
                        All stored Meta credentials (phone number ID, WABA ID, access token) will be cleared for this dealership. Incoming Meta webhooks will stop routing here until you reconnect.
                        <br /><br />
                        This does not sign you out of DealerDoodle.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleRemove}
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

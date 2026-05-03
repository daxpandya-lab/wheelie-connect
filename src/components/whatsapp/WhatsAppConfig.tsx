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
import { MessageSquare, Copy, Check, Loader2, ExternalLink, Wifi, WifiOff, QrCode } from "lucide-react";
import { toast } from "sonner";
import ScanGoModal from "./ScanGoModal";

export default function WhatsAppConfig() {
  const { tenantId } = useAuth();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [flows, setFlows] = useState<Array<{ id: string; name: string; is_active: boolean }>>([]);
  const [activatingFlow, setActivatingFlow] = useState(false);
  const [provider, setProvider] = useState<"meta" | "evolution">("meta");
  const [scanOpen, setScanOpen] = useState(false);
  const [evolutionStatus, setEvolutionStatus] = useState<string>("disconnected");
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
    const [{ data: sessionData }, { data: flowsData }] = await Promise.all([
      supabase.from("whatsapp_sessions").select("*").eq("tenant_id", tenantId).single(),
      supabase.from("chatbot_flows").select("id, name, is_active").eq("tenant_id", tenantId).order("name"),
    ]);

    if (sessionData) {
      setSession(sessionData);
    }
    // Load whatsapp_config to populate provider + creds
    const { data: tenantRow } = await supabase
      .from("tenants")
      .select("whatsapp_config")
      .eq("id", tenantId!)
      .single();
    const cfg = (tenantRow?.whatsapp_config as Record<string, any>) || {};
    setProvider(cfg.provider === "evolution" ? "evolution" : "meta");
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
    const nextConfig: Record<string, any> = {
      ...existingConfig,
      provider,
      meta: { ...(existingConfig.meta || {}) },
      evolution: { ...(existingConfig.evolution || {}) },
    };

    if (provider === "meta") {
      nextConfig.meta.phone_number_id = form.phoneNumberId.trim();
      nextConfig.meta.waba_id = form.wabaId.trim() || null;
      if (form.accessToken.trim()) {
        nextConfig.meta.access_token = form.accessToken.trim();
        // legacy field still read by some code paths
        nextConfig.access_token = form.accessToken.trim();
      }

      // Keep whatsapp_sessions in sync for Meta
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
      nextConfig.evolution.instance_url = form.evolutionUrl.trim().replace(/\/+$/, "");
      nextConfig.evolution.instance_name = form.evolutionInstance.trim();
      if (form.evolutionApiKey.trim()) {
        nextConfig.evolution.api_key = form.evolutionApiKey.trim();
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
            <Badge variant={session?.is_active ? "default" : "secondary"} className="gap-1">
              {session?.is_active ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              {session?.is_active ? "Connected" : "Not Connected"}
            </Badge>
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

      {/* WhatsApp Gateway Provider */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Primary Gateway for Chatbot</CardTitle>
          <CardDescription>
            Choose which provider receives webhooks and sends replies for this tenant's chatbot.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={provider === "meta" ? "default" : "outline"}
              onClick={() => setProvider("meta")}
            >
              Official Meta API
            </Button>
            <Button
              type="button"
              variant={provider === "evolution" ? "default" : "outline"}
              onClick={() => setProvider("evolution")}
            >
              Evolution API
            </Button>
          </div>

          {provider === "meta" ? (
            <>
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
                <Label>Permanent Access Token</Label>
                <Input
                  type="password"
                  value={form.accessToken}
                  onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                  placeholder={session ? "••••••••• (saved, enter new to update)" : "Permanent access token"}
                />
              </div>
            </>
          ) : (
            <>
              {/* Scan & Go — platform-managed instance */}
              <div className="rounded-lg border border-dashed p-4 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium flex items-center gap-2">
                      <QrCode className="w-4 h-4" /> Scan & Go
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Quickest setup — scan a QR with your phone, no API keys needed.
                    </p>
                  </div>
                  <Badge variant={evolutionStatus === "connected" ? "default" : "secondary"}>
                    {evolutionStatus}
                  </Badge>
                </div>
                <Button type="button" onClick={() => setScanOpen(true)} className="w-full">
                  <QrCode className="w-4 h-4 mr-2" />
                  {evolutionStatus === "connected" ? "Reconnect / Show QR" : "Scan QR Code"}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground pt-2">
                Or connect your own self-hosted Evolution API instance below (advanced):
              </p>
              <div className="space-y-2">
                <Label>Instance URL</Label>
                <Input
                  value={form.evolutionUrl}
                  onChange={(e) => setForm({ ...form, evolutionUrl: e.target.value })}
                  placeholder="https://evolution.yourdomain.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Instance Name</Label>
                <Input
                  value={form.evolutionInstance}
                  onChange={(e) => setForm({ ...form, evolutionInstance: e.target.value })}
                  placeholder="e.g., dealer1"
                />
              </div>
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={form.evolutionApiKey}
                  onChange={(e) => setForm({ ...form, evolutionApiKey: e.target.value })}
                  placeholder="Enter API key (leave blank to keep saved)"
                />
              </div>
            </>
          )}

          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Configuration
          </Button>
        </CardContent>
      </Card>

      <ScanGoModal
        open={scanOpen}
        onOpenChange={setScanOpen}
        tenantId={tenantId}
        onConnected={() => { setProvider("evolution"); fetchSession(); }}
      />

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

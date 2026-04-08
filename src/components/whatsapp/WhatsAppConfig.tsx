import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, Copy, Check, Loader2, ExternalLink, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";

export default function WhatsAppConfig() {
  const { tenantId } = useAuth();
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    phoneNumberId: "",
    wabaId: "",
    accessToken: "",
  });

  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || "";
  const webhookUrl = projectId
    ? `https://${projectId}.supabase.co/functions/v1/whatsapp-webhook`
    : "[Deploy to get webhook URL]";

  const fetchSession = async () => {
    if (!tenantId) { setLoading(false); return; }
    const { data } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("tenant_id", tenantId)
      .single();

    if (data) {
      setSession(data);
      setForm({
        phoneNumberId: data.phone_number_id || "",
        wabaId: data.waba_id || "",
        accessToken: "",
      });
    }
    setLoading(false);
  };

  useEffect(() => { fetchSession(); }, [tenantId]);

  const handleSave = async () => {
    if (!tenantId || !form.phoneNumberId.trim()) {
      toast.error("Phone Number ID is required");
      return;
    }
    setSaving(true);

    // Save WhatsApp session
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

    // Save access token in tenant's whatsapp_config
    if (form.accessToken.trim()) {
      const { data: tenant } = await supabase
        .from("tenants")
        .select("whatsapp_config")
        .eq("id", tenantId)
        .single();

      const existingConfig = (tenant?.whatsapp_config as Record<string, unknown>) || {};
      await supabase
        .from("tenants")
        .update({
          whatsapp_config: { ...existingConfig, access_token: form.accessToken.trim() },
        })
        .eq("id", tenantId);
    }

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

      {/* API Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">API Configuration</CardTitle>
          <CardDescription>
            Get these values from your{" "}
            <a href="https://developers.facebook.com" target="_blank" rel="noopener" className="text-primary hover:underline inline-flex items-center gap-1">
              Meta Developer Console <ExternalLink className="w-3 h-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
            <Label>Access Token</Label>
            <Input
              type="password"
              value={form.accessToken}
              onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
              placeholder={session ? "••••••••• (saved, enter new to update)" : "Permanent access token"}
            />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {session ? "Update Configuration" : "Connect WhatsApp"}
          </Button>
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

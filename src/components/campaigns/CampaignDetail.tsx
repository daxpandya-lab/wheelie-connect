import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Send, Loader2, CheckCircle, XCircle, Eye, MessageSquare } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CampaignDetailProps {
  campaignId: string;
  onBack: () => void;
}

export default function CampaignDetail({ campaignId, onBack }: CampaignDetailProps) {
  const [campaign, setCampaign] = useState<any>(null);
  const [recipients, setRecipients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [cRes, rRes] = await Promise.all([
      supabase.from("campaigns").select("*").eq("id", campaignId).single(),
      supabase.from("campaign_recipients").select("*").eq("campaign_id", campaignId).order("created_at"),
    ]);
    setCampaign(cRes.data);
    setRecipients((rRes.data as any[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
    const channel = supabase
      .channel(`campaign-${campaignId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_recipients", filter: `campaign_id=eq.${campaignId}` }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [campaignId]);

  const handleSend = async () => {
    if (!campaign) return;
    setSending(true);
    await supabase.from("campaigns").update({ status: "sending" }).eq("id", campaignId);
    // Queue messages for each recipient
    const messages = recipients.filter((r) => r.status === "pending").map((r) => ({
      tenant_id: campaign.tenant_id,
      recipient_phone: r.phone_number,
      template_name: campaign.template_id,
      status: "queued" as const,
      message_type: "template",
    }));
    if (messages.length > 0) {
      await supabase.from("whatsapp_message_queue").insert(messages);
    }
    // Trigger send
    await supabase.functions.invoke("whatsapp-send", { body: { tenant_id: campaign.tenant_id, max_batch: 50 } });
    await supabase.from("campaigns").update({ status: "sent", sent_count: messages.length }).eq("id", campaignId);
    setSending(false);
    toast.success("Campaign sent!");
    fetchData();
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!campaign) return null;

  const stats = {
    total: recipients.length,
    sent: recipients.filter((r) => ["sent", "delivered", "read", "replied"].includes(r.status)).length,
    delivered: recipients.filter((r) => ["delivered", "read", "replied"].includes(r.status)).length,
    read: recipients.filter((r) => ["read", "replied"].includes(r.status)).length,
    replied: recipients.filter((r) => r.status === "replied").length,
    failed: recipients.filter((r) => r.status === "failed").length,
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "delivered": case "read": case "replied": return <CheckCircle className="w-4 h-4 text-success" />;
      case "failed": return <XCircle className="w-4 h-4 text-destructive" />;
      case "sent": return <Send className="w-4 h-4 text-primary" />;
      default: return <div className="w-4 h-4 rounded-full bg-muted" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="w-4 h-4" /> Back</Button>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-foreground">{campaign.name}</h2>
          <p className="text-sm text-muted-foreground">Type: {campaign.type} · Status: {campaign.status}</p>
        </div>
        {campaign.status === "draft" && (
          <Button onClick={handleSend} disabled={sending || recipients.length === 0}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            Send Campaign
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {[
          { label: "Total", value: stats.total, color: "text-foreground" },
          { label: "Sent", value: stats.sent, color: "text-primary" },
          { label: "Delivered", value: stats.delivered, color: "text-primary" },
          { label: "Read", value: stats.read, color: "text-success" },
          { label: "Replied", value: stats.replied, color: "text-success" },
          { label: "Failed", value: stats.failed, color: "text-destructive" },
        ].map((s) => (
          <div key={s.label} className="glass-card rounded-xl p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Delivery funnel */}
      {stats.total > 0 && (
        <div className="glass-card rounded-xl p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Delivery Funnel</h3>
          <div className="space-y-2">
            {[
              { label: "Sent", value: stats.sent, pct: (stats.sent / stats.total) * 100 },
              { label: "Delivered", value: stats.delivered, pct: (stats.delivered / stats.total) * 100 },
              { label: "Read", value: stats.read, pct: (stats.read / stats.total) * 100 },
              { label: "Replied", value: stats.replied, pct: (stats.replied / stats.total) * 100 },
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-16">{s.label}</span>
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div className="bg-primary rounded-full h-2 transition-all" style={{ width: `${s.pct}%` }} />
                </div>
                <span className="text-xs font-medium text-foreground w-12 text-right">{s.pct.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recipients Table */}
      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All ({stats.total})</TabsTrigger>
          <TabsTrigger value="delivered">Delivered ({stats.delivered})</TabsTrigger>
          <TabsTrigger value="read">Read ({stats.read})</TabsTrigger>
          <TabsTrigger value="replied">Replied ({stats.replied})</TabsTrigger>
          <TabsTrigger value="failed">Failed ({stats.failed})</TabsTrigger>
        </TabsList>
        {["all", "delivered", "read", "replied", "failed"].map((tab) => (
          <TabsContent key={tab} value={tab}>
            <div className="glass-card rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-3 text-muted-foreground font-medium">Contact</th>
                    <th className="text-left p-3 text-muted-foreground font-medium">Phone</th>
                    <th className="text-left p-3 text-muted-foreground font-medium">Status</th>
                    <th className="text-left p-3 text-muted-foreground font-medium">Reply</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients
                    .filter((r) => tab === "all" || r.status === tab || (tab === "delivered" && ["delivered", "read", "replied"].includes(r.status)) || (tab === "read" && ["read", "replied"].includes(r.status)))
                    .map((r) => (
                      <tr key={r.id} className="border-b border-border/50">
                        <td className="p-3 text-foreground">{r.customer_name || "—"}</td>
                        <td className="p-3 text-muted-foreground">{r.phone_number}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-1.5">{statusIcon(r.status)}<span className="capitalize">{r.status}</span></div>
                        </td>
                        <td className="p-3 text-muted-foreground">{r.reply_text || "—"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

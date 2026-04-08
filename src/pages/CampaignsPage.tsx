import { useState, useEffect } from "react";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, MoreHorizontal, Loader2, Megaphone, Send, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import CreateCampaignDialog from "@/components/campaigns/CreateCampaignDialog";
import CampaignDetail from "@/components/campaigns/CampaignDetail";
import TemplateManager from "@/components/campaigns/TemplateManager";
import ContactSegments from "@/components/campaigns/ContactSegments";

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-primary/10 text-primary",
  sending: "bg-warning/10 text-warning",
  sent: "bg-success/10 text-success",
  cancelled: "bg-destructive/10 text-destructive",
};

export default function CampaignsPage() {
  const { tenantId } = useAuth();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<string | null>(null);

  const fetchCampaigns = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase
      .from("campaigns")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    setCampaigns(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchCampaigns(); }, [tenantId]);

  if (selectedCampaign) {
    return (
      <>
        <TopBar title="Campaign Details" />
        <div className="flex-1 overflow-y-auto p-6">
          <CampaignDetail campaignId={selectedCampaign} onBack={() => { setSelectedCampaign(null); fetchCampaigns(); }} />
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Campaigns" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Tabs defaultValue="campaigns">
          <div className="flex items-center justify-between mb-4">
            <TabsList>
              <TabsTrigger value="campaigns"><Megaphone className="w-4 h-4 mr-1" /> Campaigns</TabsTrigger>
              <TabsTrigger value="templates"><Send className="w-4 h-4 mr-1" /> Templates</TabsTrigger>
              <TabsTrigger value="segments"><BarChart3 className="w-4 h-4 mr-1" /> Segments</TabsTrigger>
            </TabsList>
            <Button onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" /> New Campaign</Button>
          </div>

          <TabsContent value="campaigns">
            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : campaigns.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-50" />
                <p className="text-lg font-medium">No campaigns yet</p>
                <p className="text-sm">Create your first WhatsApp campaign</p>
              </div>
            ) : (
              <div className="space-y-4">
                {campaigns.map((c) => (
                  <div
                    key={c.id}
                    className="glass-card rounded-xl p-5 cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setSelectedCampaign(c.id)}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-foreground">{c.name}</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Type: {c.type} · Created: {new Date(c.created_at).toLocaleDateString()}
                          {c.scheduled_at && ` · Scheduled: ${new Date(c.scheduled_at).toLocaleString()}`}
                        </p>
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[c.status] || ""}`}>
                        {c.status}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground">{(c.recipient_count || 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Recipients</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground">{(c.delivered_count || 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Delivered</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-foreground">{(c.read_count || 0).toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Read</p>
                      </div>
                      <div className="text-center">
                        <p className="text-lg font-bold text-primary">
                          {(c.delivered_count || 0) > 0 ? Math.round(((c.read_count || 0) / c.delivered_count) * 100) : 0}%
                        </p>
                        <p className="text-xs text-muted-foreground">Read Rate</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="templates">
            <TemplateManager />
          </TabsContent>

          <TabsContent value="segments">
            <ContactSegments />
          </TabsContent>
        </Tabs>
      </div>

      <CreateCampaignDialog open={showCreate} onOpenChange={setShowCreate} onCreated={fetchCampaigns} />
    </>
  );
}

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface CreateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export default function CreateCampaignDialog({ open, onOpenChange, onCreated }: CreateCampaignDialogProps) {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; template_name: string }[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string; customer_count: number }[]>([]);
  const [form, setForm] = useState({
    name: "",
    type: "whatsapp" as "whatsapp" | "sms" | "email",
    template_id: "",
    segment_id: "",
    scheduled_at: "",
  });

  useEffect(() => {
    if (!open || !tenantId) return;
    Promise.all([
      supabase.from("whatsapp_templates").select("id, template_name").eq("tenant_id", tenantId).eq("status", "approved"),
      supabase.from("contact_segments").select("id, name, customer_count").eq("tenant_id", tenantId),
    ]).then(([tRes, sRes]) => {
      if (tRes.data) setTemplates(tRes.data);
      if (sRes.data) setSegments(sRes.data as any);
    });
  }, [open, tenantId]);

  const handleCreate = async () => {
    if (!tenantId || !form.name.trim()) {
      toast.error("Campaign name is required");
      return;
    }
    setLoading(true);
    const { error } = await supabase.from("campaigns").insert({
      tenant_id: tenantId,
      name: form.name.trim(),
      type: form.type,
      template_id: form.template_id || null,
      scheduled_at: form.scheduled_at || null,
      status: form.scheduled_at ? "scheduled" : "draft",
    });
    setLoading(false);
    if (error) {
      toast.error("Failed to create campaign");
    } else {
      toast.success("Campaign created");
      onCreated();
      onOpenChange(false);
      setForm({ name: "", type: "whatsapp", template_id: "", segment_id: "", scheduled_at: "" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create New Campaign</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Campaign Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Service Reminder - April" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Template</Label>
              <Select value={form.template_id} onValueChange={(v) => setForm({ ...form, template_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Audience Segment</Label>
            <Select value={form.segment_id} onValueChange={(v) => setForm({ ...form, segment_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select segment" /></SelectTrigger>
              <SelectContent>
                {segments.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} ({s.customer_count} contacts)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Schedule (optional)</Label>
            <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          </div>
          <Button onClick={handleCreate} disabled={loading} className="w-full">
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Create Campaign
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

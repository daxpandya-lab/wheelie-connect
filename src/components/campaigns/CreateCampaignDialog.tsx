import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, Info } from "lucide-react";

interface CreateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

interface TemplateRecord {
  id: string;
  template_name: string;
  components: any;
}

/** Extract unique {{1}}, {{2}}... variables from a template body, in order. */
function extractVariables(components: any): string[] {
  if (!Array.isArray(components)) return [];
  const body = components.find((c: any) => (c?.type || "").toUpperCase() === "BODY");
  const text: string = body?.text || "";
  const matches = text.match(/\{\{\s*(\d+)\s*\}\}/g) || [];
  const nums = Array.from(new Set(matches.map((m) => m.replace(/\D/g, ""))));
  return nums.sort((a, b) => Number(a) - Number(b));
}

/** Detect a CAROUSEL component and return its cards with their body variables. */
function extractCarouselCards(components: any): { index: number; variables: string[] }[] {
  if (!Array.isArray(components)) return [];
  const carousel = components.find((c: any) => (c?.type || "").toUpperCase() === "CAROUSEL");
  if (!carousel?.cards || !Array.isArray(carousel.cards)) return [];
  return carousel.cards.map((card: any, idx: number) => ({
    index: idx,
    variables: extractVariables(card.components || []),
  }));
}

const VARIABLE_FIELDS = [
  { value: "name", label: "Contact name" },
  { value: "phone", label: "Phone number" },
  { value: "email", label: "Email" },
  { value: "static", label: "Static text…" },
];

export default function CreateCampaignDialog({ open, onOpenChange, onCreated }: CreateCampaignDialogProps) {
  const { tenantId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string; customer_count: number }[]>([]);
  const [form, setForm] = useState({
    name: "",
    type: "whatsapp" as "whatsapp" | "sms" | "email",
    template_id: "",
    segment_id: "",
    scheduled_at: "",
    sending_speed: "100", // messages/hour
  });
  // varMap: { "1": { source: "name" | "phone" | "email" | "static", value?: string } }
  const [varMap, setVarMap] = useState<Record<string, { source: string; value?: string }>>({});

  useEffect(() => {
    if (!open || !tenantId) return;
    Promise.all([
      supabase.from("whatsapp_templates").select("id, template_name, components").eq("tenant_id", tenantId).eq("status", "approved"),
      supabase.from("contact_segments").select("id, name, customer_count").eq("tenant_id", tenantId),
    ]).then(([tRes, sRes]) => {
      if (tRes.data) setTemplates(tRes.data as TemplateRecord[]);
      if (sRes.data) setSegments(sRes.data as any);
    });
  }, [open, tenantId]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === form.template_id) || null,
    [templates, form.template_id],
  );
  const variables = useMemo(() => (selectedTemplate ? extractVariables(selectedTemplate.components) : []), [selectedTemplate]);
  const carouselCards = useMemo(
    () => (selectedTemplate ? extractCarouselCards(selectedTemplate.components) : []),
    [selectedTemplate],
  );
  // carouselMap: { "0": { variable_key: "vehicle_model", image_url: "https://..." } }
  const [carouselMap, setCarouselMap] = useState<Record<string, { variable_key: string; image_url: string }>>({});

  // Reset variable map and provide a sensible default ({{1}} → name) when template changes
  useEffect(() => {
    if (variables.length === 0) { setVarMap({}); }
    else {
      const next: Record<string, { source: string; value?: string }> = {};
      variables.forEach((v, idx) => {
        next[v] = idx === 0 ? { source: "name" } : { source: "static", value: "" };
      });
      setVarMap(next);
    }
    // Reset carousel mapping
    if (carouselCards.length === 0) { setCarouselMap({}); }
    else {
      const next: Record<string, { variable_key: string; image_url: string }> = {};
      carouselCards.forEach((c) => { next[String(c.index)] = { variable_key: "", image_url: "" }; });
      setCarouselMap(next);
    }
  }, [form.template_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    if (!tenantId || !form.name.trim()) {
      toast.error("Campaign name is required");
      return;
    }
    // Validate carousel cards: every card must have a variable key + image URL
    if (carouselCards.length > 0) {
      const urlRe = /^https:\/\/.+/i;
      for (const card of carouselCards) {
        const m = carouselMap[String(card.index)];
        const key = m?.variable_key?.trim();
        const url = m?.image_url?.trim();
        if (!key) {
          toast.error(`Card ${card.index + 1}: Variable Key is required`);
          return;
        }
        if (!url) {
          toast.error(`Card ${card.index + 1}: Image URL is required`);
          return;
        }
        if (!urlRe.test(url)) {
          toast.error(`Card ${card.index + 1}: Image URL must start with http:// or https://`);
          return;
        }
      }
    }
    setLoading(true);
    const audience_filter: any = {
      sending_speed_per_hour: Number(form.sending_speed) || 100,
    };
    if (form.segment_id) audience_filter.segment_id = form.segment_id;
    if (variables.length) audience_filter.variable_mapping = varMap;
    if (carouselCards.length) audience_filter.carousel_mapping = carouselMap;

    const { error } = await supabase.from("campaigns").insert({
      tenant_id: tenantId,
      name: form.name.trim(),
      type: form.type,
      template_id: form.template_id || null,
      segment_id: form.segment_id || null,
      scheduled_at: form.scheduled_at || null,
      status: form.scheduled_at ? "scheduled" : "draft",
      audience_filter,
    });
    setLoading(false);
    if (error) {
      toast.error("Failed to create campaign");
    } else {
      toast.success(form.scheduled_at ? "Campaign scheduled" : "Campaign created");
      onCreated();
      onOpenChange(false);
      setForm({ name: "", type: "whatsapp", template_id: "", segment_id: "", scheduled_at: "", sending_speed: "100" });
      setVarMap({});
      setCarouselMap({});
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
              <Label>Template (Approved)</Label>
              <Select value={form.template_id} onValueChange={(v) => setForm({ ...form, template_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select template" /></SelectTrigger>
                <SelectContent>
                  {templates.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No approved templates</div>
                  ) : templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.template_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Template variable mapping */}
          {variables.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <p className="text-xs font-medium text-foreground flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-primary" /> Map template variables
              </p>
              {variables.map((v) => (
                <div key={v} className="grid grid-cols-[60px_1fr_1fr] gap-2 items-center">
                  <code className="text-xs bg-muted rounded px-1.5 py-1 text-center">{`{{${v}}}`}</code>
                  <Select
                    value={varMap[v]?.source || "static"}
                    onValueChange={(src) => setVarMap({ ...varMap, [v]: { source: src, value: varMap[v]?.value } })}
                  >
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VARIABLE_FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {varMap[v]?.source === "static" ? (
                    <Input
                      className="h-8 text-xs"
                      placeholder="Static value"
                      value={varMap[v]?.value || ""}
                      onChange={(e) => setVarMap({ ...varMap, [v]: { source: "static", value: e.target.value } })}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground italic">from contact</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Carousel cards mapping */}
          {carouselCards.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
              <p className="text-xs font-medium text-foreground flex items-center gap-1">
                <Info className="w-3.5 h-3.5 text-primary" /> Carousel cards ({carouselCards.length})
              </p>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Map each card to a contact field key (e.g. <code className="bg-muted px-1 rounded">vehicle_model</code>) and an image URL.
              </p>
              {carouselCards.map((card) => (
                <div key={card.index} className="rounded border border-border/60 bg-background p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">Card {card.index + 1}</span>
                    {card.variables.length > 0 && (
                      <span className="text-[10px] text-muted-foreground">
                        vars: {card.variables.map((v) => `{{${v}}}`).join(", ")}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      className="h-8 text-xs"
                      placeholder="Variable key (e.g. model_name)"
                      value={carouselMap[String(card.index)]?.variable_key || ""}
                      onChange={(e) =>
                        setCarouselMap({
                          ...carouselMap,
                          [String(card.index)]: {
                            variable_key: e.target.value,
                            image_url: carouselMap[String(card.index)]?.image_url || "",
                          },
                        })
                      }
                    />
                    <Input
                      className="h-8 text-xs"
                      placeholder="Image URL (https://…)"
                      value={carouselMap[String(card.index)]?.image_url || ""}
                      onChange={(e) =>
                        setCarouselMap({
                          ...carouselMap,
                          [String(card.index)]: {
                            variable_key: carouselMap[String(card.index)]?.variable_key || "",
                            image_url: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Schedule (optional)</Label>
              <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
            </div>
            <div>
              <Label>Sending Speed</Label>
              <Select value={form.sending_speed} onValueChange={(v) => setForm({ ...form, sending_speed: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="50">50 / hour (safest)</SelectItem>
                  <SelectItem value="100">100 / hour (recommended)</SelectItem>
                  <SelectItem value="250">250 / hour</SelectItem>
                  <SelectItem value="500">500 / hour</SelectItem>
                  <SelectItem value="1000">1000 / hour (high tier only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Throttling protects your WABA quality rating. Lower speeds reduce block risk.
          </p>

          <Button onClick={handleCreate} disabled={loading} className="w-full">
            {loading && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            {form.scheduled_at ? "Schedule Campaign" : "Create Campaign"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

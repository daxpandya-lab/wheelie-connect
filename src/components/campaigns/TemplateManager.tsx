import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, FileText, Loader2, Trash2 } from "lucide-react";

export default function TemplateManager() {
  const { tenantId } = useAuth();
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    template_name: "",
    category: "marketing" as "marketing" | "utility" | "authentication",
    language: "en",
    body: "",
  });
  const [saving, setSaving] = useState(false);

  const fetchTemplates = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase.from("whatsapp_templates").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false });
    setTemplates(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, [tenantId]);

  const handleCreate = async () => {
    if (!tenantId || !form.template_name.trim() || !form.body.trim()) {
      toast.error("Name and body are required");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("whatsapp_templates").insert({
      tenant_id: tenantId,
      template_name: form.template_name.trim(),
      category: form.category,
      language: form.language,
      components: [{ type: "BODY", text: form.body }],
      status: "pending",
    });
    setSaving(false);
    if (error) { toast.error("Failed to create template"); return; }
    toast.success("Template created (pending approval)");
    setShowCreate(false);
    setForm({ template_name: "", category: "marketing", language: "en", body: "" });
    fetchTemplates();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("whatsapp_templates").delete().eq("id", id);
    toast.success("Template deleted");
    fetchTemplates();
  };

  const statusColors: Record<string, string> = {
    pending: "bg-warning/10 text-warning",
    approved: "bg-success/10 text-success",
    rejected: "bg-destructive/10 text-destructive",
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-foreground">Message Templates</h3>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Template
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : templates.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No templates yet. Create your first template.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => {
            const bodyComp = (t.components as any[])?.find((c: any) => c.type === "BODY");
            return (
              <div key={t.id} className="glass-card rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-foreground">{t.template_name}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[t.status] || ""}`}>{t.status}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">{t.category}</span>
                    </div>
                    {bodyComp?.text && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{bodyComp.text}</p>}
                    <p className="text-xs text-muted-foreground mt-1">Language: {t.language}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(t.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Create Template</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Template Name</Label>
              <Input value={form.template_name} onChange={(e) => setForm({ ...form, template_name: e.target.value })} placeholder="e.g. service_reminder_v1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="utility">Utility</SelectItem>
                    <SelectItem value="authentication">Authentication</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Language</Label>
                <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="ar">Arabic</SelectItem>
                    <SelectItem value="hi">Hindi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Message Body</Label>
              <Textarea rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Hello {{1}}, your service is due on {{2}}..." />
              <p className="text-xs text-muted-foreground mt-1">Use {"{{1}}"}, {"{{2}}"} for dynamic variables</p>
            </div>
            <Button onClick={handleCreate} disabled={saving} className="w-full">
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Create Template
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

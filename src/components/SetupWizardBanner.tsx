import { useState } from "react";
import { Sparkles, Phone, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { z } from "zod";

const setupSchema = z.object({
  manager_phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s\-()]{8,20}$/, { message: "Enter a valid phone number (8-20 digits, may start with +)" })
    .max(20),
  google_review_url: z
    .string()
    .trim()
    .url({ message: "Enter a valid URL starting with https://" })
    .max(500),
});

interface Props {
  tenantId: string;
  missingPhone: boolean;
  missingReview: boolean;
  onComplete: (next: { manager_phone: string; google_review_url: string }) => void;
}

export default function SetupWizardBanner({ tenantId, missingPhone, missingReview, onComplete }: Props) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [url, setUrl] = useState("");
  const [errors, setErrors] = useState<{ manager_phone?: string; google_review_url?: string }>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const parsed = setupSchema.safeParse({ manager_phone: phone, google_review_url: url });
    if (!parsed.success) {
      const fieldErrors: typeof errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof typeof errors;
        if (key) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const { data: tenant, error: readErr } = await supabase
        .from("tenants").select("settings").eq("id", tenantId).single();
      if (readErr) throw readErr;
      const current = (tenant?.settings as Record<string, unknown>) || {};
      const next = {
        ...current,
        manager_phone: parsed.data.manager_phone,
        google_review_url: parsed.data.google_review_url,
      };
      const { error } = await supabase.from("tenants").update({ settings: next } as never).eq("id", tenantId);
      if (error) throw error;
      toast.success("Lifecycle automations are now fully configured!");
      onComplete({ manager_phone: parsed.data.manager_phone, google_review_url: parsed.data.google_review_url });
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const missingLabel = [missingPhone && "manager alerts", missingReview && "automated reviews"]
    .filter(Boolean)
    .join(" and ");

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-accent/5 to-background p-5 sm:p-6">
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/20 blur-3xl" aria-hidden />
        <div className="absolute -bottom-16 -left-10 h-40 w-40 rounded-full bg-accent/20 blur-3xl" aria-hidden />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
            <Sparkles className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-foreground">
              Welcome to AutoDealer! Your AI Bot is active.
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Just <span className="font-medium text-foreground">2 quick details</span> needed to unlock {missingLabel || "lifecycle automations"}.
            </p>
          </div>
          <Button onClick={() => setOpen(true)} size="lg" className="shrink-0 shadow-md">
            <Sparkles className="mr-2 h-4 w-4" />
            Quick Setup
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Finish your setup</DialogTitle>
            <DialogDescription>
              These power your CSAT follow-ups: 5-star customers get the review link, low ratings alert the manager instantly.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="wizard-phone" className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-primary" /> Manager WhatsApp Number
              </Label>
              <Input
                id="wizard-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                inputMode="tel"
                maxLength={20}
                aria-invalid={!!errors.manager_phone}
              />
              {errors.manager_phone && <p className="text-xs text-destructive">{errors.manager_phone}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="wizard-url" className="flex items-center gap-2">
                <Star className="h-4 w-4 text-primary" /> Google Business Review Link
              </Label>
              <Input
                id="wizard-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://g.page/r/YourDealership/review"
                maxLength={500}
                aria-invalid={!!errors.google_review_url}
              />
              {errors.google_review_url && <p className="text-xs text-destructive">{errors.google_review_url}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Later</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save & Activate"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

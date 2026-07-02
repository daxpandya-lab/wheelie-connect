import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Upload, ImageIcon, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

type Tenant = { id: string; name: string };

type Fields = {
  workshop_name: string;
  support_phone: string;
  business_address: string;
  google_review_url: string;
  logo_url: string;
  primary_color: string;
};

const EMPTY: Fields = {
  workshop_name: "",
  support_phone: "",
  business_address: "",
  google_review_url: "",
  logo_url: "",
  primary_color: "#3b82f6",
};

/**
 * Unified Dealership Info + Branding form. Dealer Admins edit their own
 * tenant. Master Super Admin ("Daxesh") gets a dropdown to override any
 * tenant. Purely additive — writes go through the existing
 * `update-tenant-branding` edge function.
 */
export default function DealershipBrandingSettings({
  focus,
}: {
  focus: "profile" | "branding";
}) {
  const { tenantId, isSuperAdmin, profile, user } = useAuth();
  const isMasterAdmin = useMemo(
    () =>
      isSuperAdmin &&
      `${profile?.full_name ?? ""} ${user?.email ?? ""}`
        .toLowerCase()
        .includes("daxesh"),
    [isSuperAdmin, profile?.full_name, user?.email],
  );

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Load tenant directory for the Super Admin selector.
  useEffect(() => {
    if (!isMasterAdmin) return;
    supabase
      .from("tenants")
      .select("id, name")
      .order("name", { ascending: true })
      .then(({ data }) => {
        if (data) setTenants(data as Tenant[]);
      });
  }, [isMasterAdmin]);

  // Resolve which tenant we're editing.
  const activeTenantId = isMasterAdmin ? selectedTenantId : tenantId;

  // Default the Super Admin selector to their own tenant on first render.
  useEffect(() => {
    if (isMasterAdmin && !selectedTenantId && tenantId) {
      setSelectedTenantId(tenantId);
    }
  }, [isMasterAdmin, selectedTenantId, tenantId]);

  // Load current values for the active tenant.
  useEffect(() => {
    if (!activeTenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from("tenants")
      .select("name, settings")
      .eq("id", activeTenantId)
      .single()
      .then(({ data }) => {
        const s = (data?.settings as Record<string, unknown>) || {};
        setFields({
          workshop_name:
            (typeof s.workshop_name === "string" && s.workshop_name) ||
            data?.name ||
            "",
          support_phone:
            typeof s.support_phone === "string" ? s.support_phone : "",
          business_address:
            typeof s.business_address === "string" ? s.business_address : "",
          google_review_url:
            typeof s.google_review_url === "string" ? s.google_review_url : "",
          logo_url: typeof s.logo_url === "string" ? s.logo_url : "",
          primary_color:
            typeof s.primary_color === "string" && /^#?[0-9a-fA-F]{6}$/.test(s.primary_color)
              ? s.primary_color.startsWith("#")
                ? s.primary_color
                : `#${s.primary_color}`
              : "#3b82f6",
        });
        setLoading(false);
      });
  }, [activeTenantId]);

  const setField = <K extends keyof Fields>(k: K, v: Fields[K]) =>
    setFields((prev) => ({ ...prev, [k]: v }));

  const uploadLogo = async (file: File) => {
    if (!activeTenantId) return;
    if (!/^image\//.test(file.type)) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Logo must be under 3MB");
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `logos/${activeTenantId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("service_media")
      .upload(path, file, { cacheControl: "3600", upsert: true, contentType: file.type });
    if (error) {
      toast.error(error.message);
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("service_media").getPublicUrl(path);
    setField("logo_url", data.publicUrl);
    setUploading(false);
    toast.success("Logo uploaded — remember to save");
  };

  const handleSave = async () => {
    if (!activeTenantId) return;
    if (fields.google_review_url && !/^https?:\/\/.+/i.test(fields.google_review_url)) {
      toast.error("Google Review URL must start with http(s)://");
      return;
    }
    const hex = fields.primary_color.trim();
    if (hex && !/^#?[0-9a-fA-F]{6}$/.test(hex)) {
      toast.error("Primary color must be a 6-digit hex like #3b82f6");
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("update-tenant-branding", {
      body: {
        // Super admin sends explicit tenant_id; dealer admin omits it and the
        // function locks to their own tenant.
        ...(isMasterAdmin ? { tenant_id: activeTenantId } : {}),
        workshop_name: fields.workshop_name.trim() || null,
        support_phone: fields.support_phone.trim() || null,
        business_address: fields.business_address.trim() || null,
        google_review_url: fields.google_review_url.trim() || null,
        logo_url: fields.logo_url.trim() || null,
        primary_color: hex || null,
      },
    });
    const err = error?.message || (data as { error?: string } | null)?.error;
    if (err) toast.error(err);
    else toast.success("Saved successfully");
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {isMasterAdmin && (
        <div className="glass-card rounded-xl p-5 border border-warning/30 bg-warning/5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="w-4 h-4 text-warning" />
            Super Admin — Editing on behalf of a dealership
          </div>
          <Label className="text-xs">Select dealership</Label>
          <Select
            value={selectedTenantId ?? ""}
            onValueChange={(v) => setSelectedTenantId(v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a dealership…" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Changes save directly to the selected dealership's profile.
          </p>
        </div>
      )}

      {focus === "profile" ? (
        <div className="glass-card rounded-xl p-6 space-y-5">
          <div>
            <h3 className="text-base font-semibold">Dealership Info</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Core contact details — used in chatbot replies and customer messages.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Workshop Trading Name</Label>
            <Input
              value={fields.workshop_name}
              onChange={(e) => setField("workshop_name", e.target.value)}
              placeholder="e.g. Smith Auto Care"
            />
          </div>
          <div className="space-y-2">
            <Label>Support Contact Phone</Label>
            <Input
              value={fields.support_phone}
              onChange={(e) => setField("support_phone", e.target.value)}
              placeholder="+91 98765 43210"
            />
          </div>
          <div className="space-y-2">
            <Label>Workshop Business Address</Label>
            <Textarea
              value={fields.business_address}
              onChange={(e) => setField("business_address", e.target.value)}
              placeholder="Street, City, State, Pincode"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Google Business Review URL</Label>
            <Input
              value={fields.google_review_url}
              onChange={(e) => setField("google_review_url", e.target.value)}
              placeholder="https://g.page/r/..."
            />
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-xl p-6 space-y-5">
          <div>
            <h3 className="text-base font-semibold">Branding</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Logo and primary accent color used across dealer-facing pages.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Workshop Logo</Label>
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-lg border bg-muted flex items-center justify-center overflow-hidden">
                {fields.logo_url ? (
                  <img
                    src={fields.logo_url}
                    alt="Logo preview"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadLogo(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploading || !activeTenantId}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  {fields.logo_url ? "Replace logo" : "Upload logo"}
                </Button>
                <Input
                  value={fields.logo_url}
                  onChange={(e) => setField("logo_url", e.target.value)}
                  placeholder="Or paste a logo URL"
                  className="text-xs"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Primary Brand Color</Label>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={
                  /^#[0-9a-fA-F]{6}$/.test(fields.primary_color)
                    ? fields.primary_color
                    : "#3b82f6"
                }
                onChange={(e) => setField("primary_color", e.target.value)}
                className="w-14 h-10 rounded border cursor-pointer bg-transparent"
              />
              <Input
                value={fields.primary_color}
                onChange={(e) => setField("primary_color", e.target.value)}
                placeholder="#3b82f6"
                className="max-w-[160px] font-mono uppercase"
              />
              <span
                className="inline-block h-6 px-3 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: fields.primary_color || "#3b82f6" }}
              >
                Preview
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Used for accent buttons and highlights on white-labeled surfaces.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving || !activeTenantId}>
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Save Configuration
        </Button>
        {isMasterAdmin && activeTenantId && (
          <span className="text-xs text-muted-foreground">
            Saving as Super Admin →{" "}
            <strong>{tenants.find((t) => t.id === activeTenantId)?.name ?? "—"}</strong>
          </span>
        )}
      </div>
    </div>
  );
}

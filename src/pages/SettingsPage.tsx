import { useState, useEffect } from "react";
import TopBar from "@/components/TopBar";
import WhatsAppConfig from "@/components/whatsapp/WhatsAppConfig";
import { Building2, Globe, Palette, Bell, Shield, CreditCard, ChevronLeft, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const sections = [
  { id: "whatsapp", icon: Globe, title: "WhatsApp Configuration", desc: "Connect your WhatsApp Business API" },
  { id: "capacity", icon: Car, title: "Service Capacity", desc: "Set daily vehicle booking limits" },
  { id: "dealership", icon: Building2, title: "Dealership Info", desc: "Business name, address, contact details" },
  { id: "branding", icon: Palette, title: "Branding", desc: "Logo, colors, and theme customization" },
  { id: "notifications", icon: Bell, title: "Notifications", desc: "Email and WhatsApp notification preferences" },
  { id: "team", icon: Shield, title: "Team & Roles", desc: "Manage team members and permissions" },
  { id: "billing", icon: CreditCard, title: "Billing & Subscription", desc: "Current plan, usage, and invoices" },
];

function CapacitySettings() {
  const { tenantId } = useAuth();
  const [maxVehicles, setMaxVehicles] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("tenants").select("settings").eq("id", tenantId).single()
      .then(({ data }) => {
        const settings = data?.settings as Record<string, unknown> | null;
        if (settings?.max_vehicles_per_day) setMaxVehicles(String(settings.max_vehicles_per_day));
        setLoading(false);
      });
  }, [tenantId]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
    const currentSettings = (tenant?.settings as Record<string, unknown>) || {};
    const newSettings = { ...currentSettings, max_vehicles_per_day: maxVehicles ? parseInt(maxVehicles) : null };
    const { error } = await supabase.from("tenants").update({ settings: newSettings } as any).eq("id", tenantId);
    if (error) toast.error(error.message);
    else toast.success("Capacity settings saved");
    setSaving(false);
  };

  if (loading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-foreground">Daily Vehicle Limit</h3>
        <p className="text-sm text-muted-foreground">Set the maximum number of vehicles that can be booked for service per day.</p>
        <div className="space-y-2 max-w-xs">
          <Label>Max Vehicles Per Day</Label>
          <Input type="number" min="1" value={maxVehicles} onChange={e => setMaxVehicles(e.target.value)} placeholder="e.g. 10" />
        </div>
        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const renderBack = () => (
    <Button variant="ghost" size="sm" onClick={() => setActiveSection(null)} className="mb-4">
      <ChevronLeft className="w-4 h-4" /> Back to Settings
    </Button>
  );

  if (activeSection === "whatsapp") {
    return (
      <>
        <TopBar title="WhatsApp Configuration" />
        <div className="flex-1 overflow-y-auto p-6"><div className="max-w-2xl">{renderBack()}<WhatsAppConfig /></div></div>
      </>
    );
  }

  if (activeSection === "capacity") {
    return (
      <>
        <TopBar title="Service Capacity" />
        <div className="flex-1 overflow-y-auto p-6"><div className="max-w-2xl">{renderBack()}<CapacitySettings /></div></div>
      </>
    );
  }

  return (
    <>
      <TopBar title="Settings" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-4">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className="w-full glass-card rounded-xl p-5 flex items-center gap-4 text-left hover:shadow-md transition-shadow"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <s.icon className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-foreground">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

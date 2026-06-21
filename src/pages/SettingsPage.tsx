import { useState, useEffect } from "react";
import TopBar from "@/components/TopBar";
import WhatsAppConfig from "@/components/whatsapp/WhatsAppConfig";
import ReminderSettings from "@/components/settings/ReminderSettings";
import { Building2, Globe, Palette, Bell, Shield, CreditCard, ChevronLeft, Car, Bot, BellRing, Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const sections = [
  { id: "profile", icon: Building2, title: "Business Profile & Branding", desc: "Workshop name, contact, address & chatbot welcome script" },
  { id: "marketing", icon: Megaphone, title: "Marketing Integrations", desc: "Google review link for post-service feedback" },
  { id: "whatsapp", icon: Globe, title: "WhatsApp Configuration", desc: "Connect your WhatsApp Business API" },
  { id: "reminders", icon: BellRing, title: "Booking Reminders", desc: "Automated WhatsApp follow-ups for service & test drives" },
  { id: "capacity", icon: Car, title: "Service Capacity", desc: "Set daily vehicle booking limits" },
  { id: "chatbot", icon: Bot, title: "Chatbot Behavior", desc: "Fuzzy matching strictness for option answers" },
  { id: "dealership", icon: Building2, title: "Dealership Info", desc: "Business name, address, contact details" },
  { id: "branding", icon: Palette, title: "Branding", desc: "Logo, colors, and theme customization" },
  { id: "notifications", icon: Bell, title: "Notifications", desc: "Email and WhatsApp notification preferences" },
  { id: "team", icon: Shield, title: "Team & Roles", desc: "Manage team members and permissions" },
  { id: "billing", icon: CreditCard, title: "Billing & Subscription", desc: "Current plan, usage, and invoices" },
];

function CapacitySettings() {
  const { tenantId } = useAuth();
  const [maxVehicles, setMaxVehicles] = useState("");
  const [advanceDays, setAdvanceDays] = useState("");
  const [holidays, setHolidays] = useState<Date[]>([]);
  const [managerPhone, setManagerPhone] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("tenants").select("settings").eq("id", tenantId).single()
      .then(({ data }) => {
        const settings = data?.settings as Record<string, unknown> | null;
        if (settings?.max_vehicles_per_day) setMaxVehicles(String(settings.max_vehicles_per_day));
        if (settings?.advance_booking_days) setAdvanceDays(String(settings.advance_booking_days));
        if (Array.isArray(settings?.holidays)) {
          setHolidays(
            (settings!.holidays as unknown[])
              .map((s) => (typeof s === "string" ? new Date(s + "T00:00:00") : null))
              .filter((d): d is Date => !!d && !isNaN(d.getTime())),
          );
        }
        if (typeof settings?.manager_phone === "string") setManagerPhone(settings.manager_phone);
        if (typeof settings?.google_review_url === "string") setReviewUrl(settings.google_review_url);
        setLoading(false);
      });
  }, [tenantId]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
    const currentSettings = (tenant?.settings as Record<string, unknown>) || {};
    const newSettings = {
      ...currentSettings,
      max_vehicles_per_day: maxVehicles ? parseInt(maxVehicles) : null,
      advance_booking_days: advanceDays ? parseInt(advanceDays) : null,
      manager_phone: managerPhone.trim() || null,
      google_review_url: reviewUrl.trim() || null,
      holidays: holidays
        .map((d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`)
        .sort(),
    };
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
      </div>

      <div className="glass-card rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-foreground">Advance Booking Window</h3>
        <p className="text-sm text-muted-foreground">
          How many days into the future customers can book. The bot will reject dates beyond this window
          and the window slides forward by one day each midnight automatically.
        </p>
        <div className="space-y-2 max-w-xs">
          <Label>Advance Booking Days</Label>
          <Input type="number" min="1" value={advanceDays} onChange={e => setAdvanceDays(e.target.value)} placeholder="e.g. 30" />
        </div>
      </div>

      <div className="glass-card rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-foreground">Holidays</h3>
        <p className="text-sm text-muted-foreground">Pick the dates your dealership is closed. The bot will refuse bookings on these days.</p>
        <Calendar
          mode="multiple"
          selected={holidays}
          onSelect={(d) => setHolidays((d as Date[]) || [])}
          className="p-3 pointer-events-auto rounded-md border border-border w-fit"
        />
        {holidays.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {holidays
              .slice()
              .sort((a, b) => a.getTime() - b.getTime())
              .map((d) => (
                <span key={d.toISOString()} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                  {d.toLocaleDateString()}
                </span>
              ))}
          </div>
        )}
      </div>

      <div className="glass-card rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-foreground">Customer Feedback (CSAT)</h3>
        <p className="text-sm text-muted-foreground">
          24h after a job is marked Completed, the bot messages the customer to rate the service 1–5.
          Low scores alert the manager; 5-star ratings receive your Google review link.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Service Manager WhatsApp</Label>
            <Input value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} placeholder="+919876543210" />
            <p className="text-xs text-muted-foreground">Receives an alert for ratings below 3.</p>
          </div>
          <div className="space-y-2">
            <Label>Google Business Review URL</Label>
            <Input value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} placeholder="https://g.page/r/..." />
            <p className="text-xs text-muted-foreground">Shared with 5-star customers.</p>
          </div>
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
    </div>
  );
}

function ChatbotSettings() {
  const { tenantId } = useAuth();
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState(0.75);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("tenants").select("settings").eq("id", tenantId).single()
      .then(({ data }) => {
        const s = (data?.settings as Record<string, unknown>) || {};
        if (typeof s.fuzzy_match_enabled === "boolean") setEnabled(s.fuzzy_match_enabled);
        if (typeof s.fuzzy_match_threshold === "number") {
          setThreshold(Math.min(1, Math.max(0.5, s.fuzzy_match_threshold)));
        }
        setLoading(false);
      });
  }, [tenantId]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", tenantId).single();
    const current = (tenant?.settings as Record<string, unknown>) || {};
    const next = {
      ...current,
      fuzzy_match_enabled: enabled,
      fuzzy_match_threshold: Number(threshold.toFixed(2)),
    };
    const { error } = await supabase.from("tenants").update({ settings: next } as never).eq("id", tenantId);
    if (error) toast.error(error.message);
    else toast.success("Chatbot settings saved");
    setSaving(false);
  };

  if (loading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  const strictnessLabel =
    threshold >= 0.9 ? "Very strict" :
    threshold >= 0.8 ? "Strict" :
    threshold >= 0.7 ? "Balanced" :
    threshold >= 0.6 ? "Lenient" : "Very lenient";

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-xl p-6 space-y-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">Fuzzy Option Matching</h3>
          <p className="text-sm text-muted-foreground mt-1">
            When enabled, the chatbot accepts minor typos in answers to multiple-choice questions
            (e.g. "carr" → "Car"). Higher thresholds require closer matches.
          </p>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <Label htmlFor="fuzzy-toggle" className="font-medium">Enable fuzzy matching</Label>
            <p className="text-xs text-muted-foreground">Disable to require exact button taps only.</p>
          </div>
          <Switch id="fuzzy-toggle" checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className={`space-y-3 ${enabled ? "" : "opacity-50 pointer-events-none"}`}>
          <div className="flex items-center justify-between">
            <Label>Match threshold</Label>
            <span className="text-sm font-medium text-foreground">
              {Math.round(threshold * 100)}% · {strictnessLabel}
            </span>
          </div>
          <Slider
            value={[threshold]}
            min={0.5}
            max={1}
            step={0.05}
            onValueChange={(v) => setThreshold(v[0])}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>50% (lenient)</span>
            <span>100% (exact)</span>
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
      </div>
    </div>
  );
}


function ProfileBrandingSettings() {
  const { tenantId } = useAuth();
  const [workshopName, setWorkshopName] = useState("");
  const [supportPhone, setSupportPhone] = useState("");
  const [address, setAddress] = useState("");
  const [welcomeScript, setWelcomeScript] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("tenants").select("name, settings").eq("id", tenantId).single()
      .then(({ data }) => {
        const s = (data?.settings as Record<string, unknown>) || {};
        setWorkshopName(typeof s.workshop_name === "string" ? s.workshop_name : (data?.name ?? ""));
        setSupportPhone(typeof s.support_phone === "string" ? s.support_phone : "");
        setAddress(typeof s.business_address === "string" ? s.business_address : "");
        setWelcomeScript(typeof s.chatbot_welcome_script === "string" ? s.chatbot_welcome_script : "");
        setLoading(false);
      });
  }, [tenantId]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("update-tenant-branding", {
      body: {
        workshop_name: workshopName.trim() || null,
        support_phone: supportPhone.trim() || null,
        business_address: address.trim() || null,
        chatbot_welcome_script: welcomeScript.trim() || null,
      },
    });
    if (error || (data && (data as { error?: string }).error)) {
      toast.error(error?.message || (data as { error?: string })?.error || "Save failed");
    } else {
      toast.success("Profile & branding saved");
    }
    setSaving(false);
  };

  if (loading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-xl p-6 space-y-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">Business Profile & Branding</h3>
          <p className="text-sm text-muted-foreground mt-1">
            These details power your chatbot greeting and customer-facing messages.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Workshop Trading Name</Label>
          <Input value={workshopName} onChange={(e) => setWorkshopName(e.target.value)} placeholder="e.g. Smith Auto Care" />
        </div>
        <div className="space-y-2">
          <Label>Support Contact Phone</Label>
          <Input value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="+91 98765 43210" />
        </div>
        <div className="space-y-2">
          <Label>Workshop Business Address</Label>
          <Textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, City, State, Pincode" rows={2} />
        </div>
        <div className="space-y-2">
          <Label>Custom Chatbot Welcome Script</Label>
          <Textarea
            value={welcomeScript}
            onChange={(e) => setWelcomeScript(e.target.value)}
            placeholder="e.g., Welcome to [Workshop Name]! How can we help you today?"
            rows={3}
          />
          <p className="text-xs text-muted-foreground">Shown as the first message in every new chatbot session.</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground">
          {saving ? "Saving..." : "Save Configuration"}
        </Button>
      </div>
    </div>
  );
}

function MarketingSettings() {
  const { tenantId } = useAuth();
  const [reviewUrl, setReviewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    supabase.from("tenants").select("settings").eq("id", tenantId).single()
      .then(({ data }) => {
        const s = (data?.settings as Record<string, unknown>) || {};
        if (typeof s.google_review_url === "string") setReviewUrl(s.google_review_url);
        setLoading(false);
      });
  }, [tenantId]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("update-tenant-branding", {
      body: { google_review_url: reviewUrl.trim() || null },
    });
    if (error || (data && (data as { error?: string }).error)) {
      toast.error(error?.message || (data as { error?: string })?.error || "Save failed");
    } else {
      toast.success("Marketing integrations saved");
    }
    setSaving(false);
  };

  if (loading) return <p className="text-muted-foreground text-sm">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="glass-card rounded-xl p-6 space-y-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">Marketing Integrations</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Customers who rate your service 4 or 5 stars will be automatically routed to this link.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Google Business Review URL</Label>
          <Input value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} placeholder="https://g.page/r/..." />
          <p className="text-xs text-muted-foreground">Used by the post-service feedback automation.</p>
        </div>
        <Button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground">
          {saving ? "Saving..." : "Save Configuration"}
        </Button>
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

  if (activeSection === "profile") {
    return (
      <>
        <TopBar title="Business Profile & Branding" />
        <div className="flex-1 overflow-y-auto p-6"><div className="max-w-2xl">{renderBack()}<ProfileBrandingSettings /></div></div>
      </>
    );
  }

  if (activeSection === "marketing") {
    return (
      <>
        <TopBar title="Marketing Integrations" />
        <div className="flex-1 overflow-y-auto p-6"><div className="max-w-2xl">{renderBack()}<MarketingSettings /></div></div>
      </>
    );
  }

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

  if (activeSection === "chatbot") {
    return (
      <>
        <TopBar title="Chatbot Behavior" />
        <div className="flex-1 overflow-y-auto p-6"><div className="max-w-2xl">{renderBack()}<ChatbotSettings /></div></div>
      </>
    );
  }

  if (activeSection === "reminders") {
    return (
      <>
        <TopBar title="Booking Reminders" />
        <div className="flex-1 overflow-y-auto p-6"><div className="max-w-3xl">{renderBack()}<ReminderSettings /></div></div>
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

import { useState } from "react";
import TopBar from "@/components/TopBar";
import WhatsAppConfig from "@/components/whatsapp/WhatsAppConfig";
import { Building2, Globe, Palette, Bell, Shield, CreditCard, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

const sections = [
  { id: "whatsapp", icon: Globe, title: "WhatsApp Configuration", desc: "Connect your WhatsApp Business API" },
  { id: "dealership", icon: Building2, title: "Dealership Info", desc: "Business name, address, contact details" },
  { id: "branding", icon: Palette, title: "Branding", desc: "Logo, colors, and theme customization" },
  { id: "notifications", icon: Bell, title: "Notifications", desc: "Email and WhatsApp notification preferences" },
  { id: "team", icon: Shield, title: "Team & Roles", desc: "Manage team members and permissions" },
  { id: "billing", icon: CreditCard, title: "Billing & Subscription", desc: "Current plan, usage, and invoices" },
];

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  if (activeSection === "whatsapp") {
    return (
      <>
        <TopBar title="WhatsApp Configuration" />
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl">
            <Button variant="ghost" size="sm" onClick={() => setActiveSection(null)} className="mb-4">
              <ChevronLeft className="w-4 h-4" /> Back to Settings
            </Button>
            <WhatsAppConfig />
          </div>
        </div>
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

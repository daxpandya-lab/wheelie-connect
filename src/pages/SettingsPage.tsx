import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Building2, Globe, Palette, Bell, Shield, CreditCard } from "lucide-react";

const sections = [
  { icon: Building2, title: "Dealership Info", desc: "Business name, address, contact details" },
  { icon: Globe, title: "WhatsApp Configuration", desc: "Connect your WhatsApp Business API" },
  { icon: Palette, title: "Branding", desc: "Logo, colors, and theme customization" },
  { icon: Bell, title: "Notifications", desc: "Email and WhatsApp notification preferences" },
  { icon: Shield, title: "Team & Roles", desc: "Manage team members and permissions" },
  { icon: CreditCard, title: "Billing & Subscription", desc: "Current plan, usage, and invoices" },
];

export default function SettingsPage() {
  return (
    <>
      <TopBar title="Settings" />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-4">
          {sections.map((s) => (
            <button
              key={s.title}
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

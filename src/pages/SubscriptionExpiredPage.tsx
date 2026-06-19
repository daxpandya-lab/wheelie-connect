import { useAuth } from "@/contexts/AuthContext";
import { AlertTriangle, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSearchParams } from "react-router-dom";

export default function SubscriptionExpiredPage() {
  const { signOut } = useAuth();
  const [params] = useSearchParams();
  const reason = params.get("reason") === "suspended" ? "suspended" : "expired";

  const title = reason === "suspended" ? "Subscription Renewal Required" : "Subscription Expired";
  const body =
    reason === "suspended"
      ? "This workshop account has been temporarily suspended by the platform administrator. Please contact our sales team to renew your subscription and restore access to your workspace."
      : "Your subscription has expired. Please contact our sales team to renew your plan and regain access.";
  const Icon = reason === "suspended" ? Ban : AlertTriangle;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto">
          <Icon className="w-8 h-8 text-warning" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <p className="text-muted-foreground">{body}</p>
        </div>
        <div className="space-y-3">
          <Button className="w-full" onClick={() => window.open("mailto:sales@dealerdoodle.com", "_blank")}>
            Contact Sales
          </Button>
          <Button variant="ghost" className="w-full" onClick={signOut}>
            Sign Out
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useAuth } from "@/contexts/AuthContext";
import { Car, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SubscriptionExpiredPage() {
  const { signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-8 h-8 text-warning" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Subscription Expired</h1>
          <p className="text-muted-foreground">
            Your subscription has expired. Please contact our sales team to renew your plan and regain access.
          </p>
        </div>
        <div className="space-y-3">
          <Button className="w-full" onClick={() => window.open("mailto:sales@autodealer.com", "_blank")}>
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

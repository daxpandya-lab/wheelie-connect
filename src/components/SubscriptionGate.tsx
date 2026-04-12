import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

export default function SubscriptionGate() {
  const { tenantId, isSuperAdmin } = useAuth();
  const [checking, setChecking] = useState(true);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (isSuperAdmin || !tenantId) {
      setChecking(false);
      return;
    }

    supabase.from("tenants").select("subscription_end_date").eq("id", tenantId).single()
      .then(({ data }) => {
        if (data?.subscription_end_date) {
          const endDate = new Date(data.subscription_end_date);
          if (endDate < new Date()) {
            setExpired(true);
          }
        }
        setChecking(false);
      });
  }, [tenantId, isSuperAdmin]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (expired) {
    return <Navigate to="/subscription-expired" replace />;
  }

  return <Outlet />;
}

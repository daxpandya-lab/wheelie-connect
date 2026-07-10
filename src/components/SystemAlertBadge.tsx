import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * Compact badge shown in the TopBar when the gateway heartbeat has flagged a
 * problem (auth failure, unreachable, or provider update detected). Additive:
 * renders nothing when everything is healthy.
 */
export default function SystemAlertBadge() {
  const { tenantId, isSuperAdmin } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!tenantId && !isSuperAdmin) return;
    let cancelled = false;
    const load = async () => {
      let q = supabase
        .from("gateway_health_status")
        .select("id, status, action_required", { count: "exact", head: false });
      if (tenantId && !isSuperAdmin) q = q.eq("tenant_id", tenantId);
      const { data } = await q;
      if (cancelled) return;
      const bad = (data || []).filter(
        (r: any) => r.action_required || ["auth_failure", "unreachable"].includes(r.status),
      );
      setCount(bad.length);
    };
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, [tenantId, isSuperAdmin]);

  if (count === 0) return null;
  return (
    <Link
      to="/settings"
      className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors"
      title="Gateway health issue detected — open Settings › Notifications"
    >
      <AlertTriangle className="w-3.5 h-3.5" />
      System Alert{count > 1 ? ` (${count})` : ""}
    </Link>
  );
}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const BUCKETS = ["service_media", "service-intake-media", "tenant_invoices"];
const STALE_MS = 1000 * 60 * 60 * 24; // 24h => stale/red

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace("Bearer ", "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is super_admin
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: uErr } = await userClient.auth.getUser(token);
    if (uErr || !userData?.user) return json({ error: "Invalid token" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "super_admin")
      .maybeSingle();
    if (!roleRow) return json({ error: "Forbidden" }, 403);

    // Tenants
    const { data: tenants } = await admin.from("tenants").select("id,name,status,plan");
    const tenantList = tenants || [];
    const totalActive = tenantList.filter((t) => t.status === "active").length;

    // Rough revenue mapping per plan
    const PLAN_PRICE: Record<string, number> = {
      free: 0, starter: 29, pro: 99, business: 199, enterprise: 499,
    };
    const revenue = tenantList
      .filter((t) => t.status === "active")
      .reduce((sum, t) => sum + (PLAN_PRICE[String(t.plan || "free").toLowerCase()] ?? 0), 0);

    // WhatsApp sessions
    const { data: waSessions } = await admin
      .from("whatsapp_sessions")
      .select("tenant_id,is_active,last_webhook_at,updated_at");
    const waMap: Record<string, { status: "connected" | "idle" | "timeout"; last_webhook_at: string | null }> = {};
    let connectedCount = 0;
    for (const s of waSessions || []) {
      const last = s.last_webhook_at ? new Date(s.last_webhook_at).getTime() : 0;
      const age = Date.now() - last;
      let status: "connected" | "idle" | "timeout" = "idle";
      if (!s.is_active) status = "idle";
      else if (!last) status = "idle";
      else if (age > STALE_MS) status = "timeout";
      else { status = "connected"; connectedCount++; }
      waMap[s.tenant_id] = { status, last_webhook_at: s.last_webhook_at };
    }
    const waTotal = (waSessions || []).length;

    // Storage per tenant — query storage.objects directly via service role
    const storageByTenant: Record<string, number> = {};
    let totalStorage = 0;
    for (const bucket of BUCKETS) {
      const { data: objs, error } = await admin
        .schema("storage")
        .from("objects")
        .select("name,metadata,bucket_id")
        .eq("bucket_id", bucket)
        .limit(10000);
      if (error) continue;
      for (const o of objs || []) {
        const size = Number((o as any).metadata?.size || 0);
        if (!size) continue;
        totalStorage += size;
        // path convention: <tenant_id>/...
        const tid = String(o.name || "").split("/")[0];
        if (tid) storageByTenant[tid] = (storageByTenant[tid] || 0) + size;
      }
    }

    return json({
      totals: {
        active_tenants: totalActive,
        all_tenants: tenantList.length,
        active_revenue: revenue,
        wa_connected: connectedCount,
        wa_total: waTotal,
        storage_bytes: totalStorage,
      },
      whatsapp_by_tenant: waMap,
      storage_by_tenant: storageByTenant,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

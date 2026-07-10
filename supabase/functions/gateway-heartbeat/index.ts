import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Track expected/current versions so we can flag provider deprecations.
const META_EXPECTED_VERSION = "v21.0";
const EVOLUTION_EXPECTED_MAJOR = 2;

type Provider = "meta" | "evolution";

interface HealthResult {
  status: "operational" | "degraded" | "action_required" | "auth_failure" | "unreachable";
  version: string | null;
  action_required: boolean;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

async function checkMeta(cfg: any): Promise<HealthResult> {
  const meta = cfg?.meta || {};
  const phoneId = meta.phone_number_id;
  const token = meta.access_token || cfg?.access_token;
  if (!phoneId || !token) {
    return { status: "action_required", version: null, action_required: true,
      error_message: "Meta credentials incomplete", metadata: {} };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${META_EXPECTED_VERSION}/${phoneId}?fields=verified_name,quality_rating,display_phone_number`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403 || body?.error?.type === "OAuthException") {
      return { status: "auth_failure", version: META_EXPECTED_VERSION, action_required: true,
        error_message: body?.error?.message || "Meta token invalid or expired",
        metadata: { http: res.status } };
    }
    if (!res.ok) {
      // Check for API version deprecation hints
      const msg = String(body?.error?.message || "");
      const deprecated = /deprecat|unsupported version|no longer/i.test(msg);
      return { status: deprecated ? "action_required" : "degraded",
        version: META_EXPECTED_VERSION, action_required: deprecated,
        error_message: msg || `HTTP ${res.status}`, metadata: { http: res.status } };
    }
    return { status: "operational", version: META_EXPECTED_VERSION, action_required: false,
      error_message: null, metadata: { verified_name: body?.verified_name, quality: body?.quality_rating } };
  } catch (e) {
    return { status: "unreachable", version: META_EXPECTED_VERSION, action_required: true,
      error_message: String(e?.message || e), metadata: {} };
  }
}

async function checkEvolution(cfg: any): Promise<HealthResult> {
  const ev = cfg?.evolution || {};
  const url = (ev.instance_url || Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/+$/, "");
  const key = ev.api_key || Deno.env.get("EVOLUTION_API_KEY") || "";
  const inst = ev.instance_name;
  if (!url || !key || !inst) {
    return { status: "action_required", version: null, action_required: true,
      error_message: "Evolution config incomplete", metadata: {} };
  }
  try {
    // Version endpoint
    let version: string | null = null;
    try {
      const vRes = await fetch(`${url}/`, { headers: { apikey: key } });
      const vBody = await vRes.json().catch(() => ({}));
      version = vBody?.version || vBody?.data?.version || null;
    } catch { /* ignore */ }

    const res = await fetch(`${url}/instance/connectionState/${encodeURIComponent(inst)}`, {
      headers: { apikey: key },
    });
    if (res.status === 401 || res.status === 403) {
      return { status: "auth_failure", version, action_required: true,
        error_message: "Evolution API key rejected", metadata: { http: res.status } };
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { status: "unreachable", version, action_required: true,
        error_message: body?.message || `HTTP ${res.status}`, metadata: { http: res.status } };
    }
    const state = body?.instance?.state || body?.state || "unknown";
    const connected = state === "open" || state === "connected";

    // Version deprecation detection
    let actionRequired = false;
    let statusFinal: HealthResult["status"] = connected ? "operational" : "degraded";
    if (version) {
      const major = parseInt(String(version).split(".")[0] || "0", 10);
      if (major && major < EVOLUTION_EXPECTED_MAJOR) {
        actionRequired = true;
        statusFinal = "action_required";
      }
    }
    return { status: statusFinal, version, action_required: actionRequired,
      error_message: connected ? null : `Instance state: ${state}`,
      metadata: { state } };
  } catch (e) {
    return { status: "unreachable", version: null, action_required: true,
      error_message: String(e?.message || e), metadata: {} };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const url = new URL(req.url);
    const tenantFilter = url.searchParams.get("tenant_id");

    let q = supabase.from("tenants").select("id, name, whatsapp_config").eq("status", "active");
    if (tenantFilter) q = q.eq("id", tenantFilter);
    const { data: tenants, error } = await q;
    if (error) return json({ error: error.message }, 500);

    const results: any[] = [];
    for (const t of tenants || []) {
      const cfg = (t.whatsapp_config as any) || {};
      const provider: Provider = cfg.provider === "evolution" ? "evolution" : "meta";
      if (!cfg.provider) continue; // skip tenants that never configured a gateway

      const health = provider === "meta" ? await checkMeta(cfg) : await checkEvolution(cfg);
      const isSuccess = health.status === "operational";

      const { error: upErr } = await supabase.from("gateway_health_status").upsert({
        tenant_id: t.id,
        provider,
        status: health.status,
        version: health.version,
        error_message: health.error_message,
        action_required: health.action_required,
        metadata: health.metadata,
        last_check_at: new Date().toISOString(),
        ...(isSuccess ? { last_success_at: new Date().toISOString() } : {}),
      }, { onConflict: "tenant_id,provider" });

      // Notify super admins on hard failures
      if (health.action_required || health.status === "auth_failure" || health.status === "unreachable") {
        await supabase.from("notifications").insert({
          tenant_id: t.id,
          user_id: null,
          title: `Gateway ${provider} — ${health.status}`,
          message: `${t.name}: ${health.error_message || "check gateway"}`,
          type: health.status === "operational" ? "info" : "warning",
          source: "gateway_heartbeat",
          source_id: null,
        }).catch(() => {});
      }

      results.push({ tenant_id: t.id, provider, ...health, upsert_error: upErr?.message });
    }

    return json({ ok: true, checked: results.length, results });
  } catch (e) {
    console.error("gateway-heartbeat error:", e);
    return json({ error: String(e) }, 500);
  }
});

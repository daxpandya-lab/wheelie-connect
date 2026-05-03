import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const evoUrl = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/+$/, "");
    const evoGlobalKey = Deno.env.get("EVOLUTION_API_KEY") || "";

    if (!evoUrl || !evoGlobalKey) {
      return json({ error: "Evolution API not configured on the platform. Set EVOLUTION_API_URL and EVOLUTION_API_KEY." }, 503);
    }

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsErr || !claims?.claims?.sub) return json({ error: "Invalid token" }, 401);

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const tenant_id = typeof body.tenant_id === "string" ? body.tenant_id.trim() : "";
    if (!/^[0-9a-f-]{36}$/.test(tenant_id)) return json({ error: "Valid tenant_id required" }, 400);

    // Verify caller belongs to this tenant
    const { data: profile } = await userClient
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", claims.claims.sub)
      .maybeSingle();
    if (!profile || profile.tenant_id !== tenant_id) {
      return json({ error: "Forbidden" }, 403);
    }

    const instanceName = `tenant-${tenant_id}`;
    const webhookUrl = `${supabaseUrl}/functions/v1/whatsapp-webhook`;

    const evoFetch = async (path: string, init: RequestInit = {}) => {
      const res = await fetch(`${evoUrl}${path}`, {
        ...init,
        headers: {
          apikey: evoGlobalKey,
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      return { ok: res.ok, status: res.status, data };
    };

    if (action === "create_and_qr") {
      // 1. Try create instance (idempotent — ignore "already exists")
      const createRes = await evoFetch(`/instance/create`, {
        method: "POST",
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
          webhook: {
            url: webhookUrl,
            byEvents: false,
            base64: false,
            events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
          },
        }),
      });
      console.log(`[evolution-connect] create status=${createRes.status}`);

      // 2. Fetch QR code
      let qrcode: string | null = createRes.data?.qrcode?.base64 || null;
      if (!qrcode) {
        const qrRes = await evoFetch(`/instance/connect/${encodeURIComponent(instanceName)}`, { method: "GET" });
        qrcode = qrRes.data?.base64 || qrRes.data?.qrcode?.base64 || null;
      }

      // 3. Persist pending state in tenant config
      const { data: tenantRow } = await supabase
        .from("tenants").select("whatsapp_config").eq("id", tenant_id).single();
      const cfg = (tenantRow?.whatsapp_config as Record<string, any>) || {};
      const next = {
        ...cfg,
        provider: "evolution",
        evolution: {
          ...(cfg.evolution || {}),
          instance_url: evoUrl,
          instance_name: instanceName,
          api_key: evoGlobalKey,
          status: "pending",
          webhook_url: webhookUrl,
        },
      };
      await supabase.from("tenants").update({ whatsapp_config: next }).eq("id", tenant_id);

      return json({ instanceName, qrcode, webhookUrl });
    }

    if (action === "status") {
      const stateRes = await evoFetch(`/instance/connectionState/${encodeURIComponent(instanceName)}`, { method: "GET" });
      const state =
        stateRes.data?.instance?.state ||
        stateRes.data?.state ||
        stateRes.data?.status ||
        "unknown";
      const connected = state === "open" || state === "connected";

      if (connected) {
        const { data: tenantRow } = await supabase
          .from("tenants").select("whatsapp_config").eq("id", tenant_id).single();
        const cfg = (tenantRow?.whatsapp_config as Record<string, any>) || {};
        const next = {
          ...cfg,
          provider: "evolution",
          evolution: {
            ...(cfg.evolution || {}),
            instance_url: evoUrl,
            instance_name: instanceName,
            api_key: evoGlobalKey,
            status: "connected",
            webhook_url: webhookUrl,
            connected_at: new Date().toISOString(),
          },
        };
        await supabase.from("tenants").update({ whatsapp_config: next }).eq("id", tenant_id);

        // Re-assert the webhook (in case create skipped it)
        await evoFetch(`/webhook/set/${encodeURIComponent(instanceName)}`, {
          method: "POST",
          body: JSON.stringify({
            webhook: {
              url: webhookUrl,
              byEvents: false,
              base64: false,
              events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
            },
          }),
        }).catch(() => {});
      }

      return json({ state, connected });
    }

    if (action === "disconnect") {
      await evoFetch(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: "DELETE" }).catch(() => {});
      const { data: tenantRow } = await supabase
        .from("tenants").select("whatsapp_config").eq("id", tenant_id).single();
      const cfg = (tenantRow?.whatsapp_config as Record<string, any>) || {};
      const next = {
        ...cfg,
        evolution: { ...(cfg.evolution || {}), status: "disconnected" },
      };
      await supabase.from("tenants").update({ whatsapp_config: next }).eq("id", tenant_id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("evolution-connect error:", err);
    return json({ error: String(err) }, 500);
  }
});

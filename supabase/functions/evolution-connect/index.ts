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
      const normalizeQr = (v: any): string | null => {
        if (!v) return null;
        if (typeof v === "string") {
          return v.startsWith("data:") ? v : `data:image/png;base64,${v}`;
        }
        const b64 = v.base64 || v.qrcode?.base64 || v.qr || null;
        if (b64) return b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
        return null;
      };

      // 1. Try minimal create first (Evolution v1.8.2 rejects some nested webhook shapes → 400)
      let createRes = await evoFetch(`/instance/create`, {
        method: "POST",
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }),
      });
      console.log(`[evolution-connect] create status=${createRes.status} body=${JSON.stringify(createRes.data)?.slice(0, 400)}`);

      // If create failed for a reason other than "already exists", surface it.
      const alreadyExists =
        createRes.status === 403 ||
        createRes.status === 409 ||
        (createRes.status === 400 &&
          JSON.stringify(createRes.data || {}).toLowerCase().includes("already"));

      if (!createRes.ok && !alreadyExists) {
        return json({
          error: "Evolution create failed",
          status: createRes.status,
          detail: createRes.data,
        }, 502);
      }

      const instanceToken: string | null =
        createRes.data?.hash?.apikey ||
        (typeof createRes.data?.hash === "string" ? createRes.data.hash : null) ||
        createRes.data?.instance?.instanceApikey ||
        null;

      // 2. Fetch QR — prefer create response, otherwise call /instance/connect/{name}
      let qrcode: string | null = normalizeQr(createRes.data?.qrcode) || normalizeQr(createRes.data);
      if (!qrcode) {
        const qrRes = await evoFetch(`/instance/connect/${encodeURIComponent(instanceName)}`, { method: "GET" });
        console.log(`[evolution-connect] connect status=${qrRes.status}`);
        qrcode = normalizeQr(qrRes.data);
      }

      // 3. Register webhook separately (v1.8.2 uses flat body under `/webhook/set/{instance}`)
      await evoFetch(`/webhook/set/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        body: JSON.stringify({
          url: webhookUrl,
          webhook_by_events: false,
          webhook_base64: false,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"],
        }),
      }).catch(() => {});

      // Mirror into whatsapp_instances
      await supabase.from("whatsapp_instances").upsert({
        tenant_id,
        instance_name: instanceName,
        instance_token: instanceToken,
        status: "pending",
        webhook_url: webhookUrl,
      }, { onConflict: "tenant_id" });

      // Persist pending state in tenant config
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

      if (!qrcode) {
        return json({
          instanceName,
          qrcode: null,
          webhookUrl,
          error: "QR code not returned by Evolution API. Check EVOLUTION_API_URL/KEY and instance state.",
        }, 502);
      }

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

        // Mirror connected state into whatsapp_instances
        await supabase.from("whatsapp_instances").upsert({
          tenant_id,
          instance_name: instanceName,
          status: "connected",
          webhook_url: webhookUrl,
          connected_at: new Date().toISOString(),
          last_event_at: new Date().toISOString(),
        }, { onConflict: "tenant_id" });

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
      await supabase.from("whatsapp_instances")
        .update({ status: "disconnected", disconnected_at: new Date().toISOString() })
        .eq("tenant_id", tenant_id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("evolution-connect error:", err);
    return json({ error: String(err) }, 500);
  }
});

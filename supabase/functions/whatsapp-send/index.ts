import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // JWT validation
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const tenant_id = typeof body.tenant_id === "string" ? body.tenant_id.trim() : null;
    const max_batch = typeof body.max_batch === "number" && body.max_batch > 0 ? Math.min(body.max_batch, 100) : 50;

    if (!tenant_id || !/^[0-9a-f-]{36}$/.test(tenant_id)) {
      return new Response(JSON.stringify({ error: "Valid tenant_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify tenant is active and get WhatsApp config
    const { data: tenantData } = await supabase
      .from("tenants")
      .select("status, whatsapp_config")
      .eq("id", tenant_id)
      .single();

    if (!tenantData || tenantData.status !== "active") {
      return new Response(JSON.stringify({ error: "Tenant is not active" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const waConfig = (tenantData.whatsapp_config as Record<string, any>) || {};
    const provider: "meta" | "evolution" = waConfig.provider === "evolution" ? "evolution" : "meta";

    // Meta credentials (with legacy fallbacks)
    const metaAccessToken = waConfig.meta?.access_token || waConfig.access_token;
    let metaPhoneNumberId: string | null = waConfig.meta?.phone_number_id || null;

    // Evolution credentials
    const evoUrl: string | undefined = waConfig.evolution?.instance_url;
    const evoInstance: string | undefined = waConfig.evolution?.instance_name;
    const evoApiKey: string | undefined = waConfig.evolution?.api_key;

    if (provider === "meta") {
      if (!metaAccessToken) {
        return new Response(JSON.stringify({ error: "WhatsApp access token not configured" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!metaPhoneNumberId) {
        const { data: session } = await supabase
          .from("whatsapp_sessions")
          .select("phone_number_id")
          .eq("tenant_id", tenant_id)
          .eq("is_active", true)
          .single();
        if (!session) {
          return new Response(JSON.stringify({ error: "No active WhatsApp session" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        metaPhoneNumberId = session.phone_number_id;
      }
    } else {
      if (!evoUrl || !evoInstance || !evoApiKey) {
        return new Response(JSON.stringify({ error: "Evolution API not fully configured" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Helper: replace {{name}}, {{phone}}, {{vehicle_model}}, {{booking_date}} placeholders
    const renderVariables = (text: string, ctx: Record<string, string | null | undefined>): string => {
      if (!text) return text;
      return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => {
        const v = ctx[key.toLowerCase()];
        return v == null || v === "" ? `{{${key}}}` : String(v);
      });
    };


    // Fetch queued messages
    const { data: messages } = await supabase
      .from("whatsapp_message_queue")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(max_batch);

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;

    for (const msg of messages) {
      await supabase
        .from("whatsapp_message_queue")
        .update({ status: "sending", attempts: msg.attempts + 1, last_attempt_at: new Date().toISOString() })
        .eq("id", msg.id);

      try {
        // Build variable context for placeholder substitution.
        // Look up customer + most recent service booking by phone number.
        const ctx: Record<string, string> = {
          phone: msg.recipient_phone || "",
        };
        const { data: cust } = await supabase
          .from("customers")
          .select("name")
          .eq("tenant_id", tenant_id)
          .eq("phone", msg.recipient_phone)
          .limit(1)
          .maybeSingle();
        if (cust?.name) ctx.name = cust.name;

        const { data: booking } = await supabase
          .from("service_bookings")
          .select("customer_name, vehicle_model, booking_date")
          .eq("tenant_id", tenant_id)
          .eq("phone_number", msg.recipient_phone)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (booking) {
          if (!ctx.name && booking.customer_name) ctx.name = booking.customer_name;
          if (booking.vehicle_model) ctx.vehicle_model = booking.vehicle_model;
          if (booking.booking_date) ctx.booking_date = booking.booking_date;
        }
        if (!ctx.name) ctx.name = "there";

        const renderedContent = msg.content ? renderVariables(msg.content, ctx) : msg.content;

        let response: Response;
        let result: any;

        if (provider === "meta") {
          let waBody: Record<string, unknown>;
          if (msg.template_name) {
            waBody = {
              messaging_product: "whatsapp",
              to: msg.recipient_phone,
              type: "template",
              template: {
                name: msg.template_name,
                language: { code: "en" },
                components: msg.template_params || [],
              },
            };
          } else {
            waBody = {
              messaging_product: "whatsapp",
              to: msg.recipient_phone,
              type: "text",
              text: { body: renderedContent },
            };
          }

          const metaUrl = `https://graph.facebook.com/v21.0/${metaPhoneNumberId}/messages`;
          console.log(`[BATCH-SEND][META] POST ${metaUrl}`);
          response = await fetch(metaUrl, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${metaAccessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(waBody),
          });
          result = await response.json();
        } else {
          // Evolution API: POST {instance_url}/message/sendText/{instance_name}
          const evoEndpoint = `${evoUrl}/message/sendText/${encodeURIComponent(evoInstance!)}`;
          const evoBody = {
            number: msg.recipient_phone,
            text: renderedContent ?? "",
          };
          console.log(`[BATCH-SEND][EVOLUTION] POST ${evoEndpoint}`);
          response = await fetch(evoEndpoint, {
            method: "POST",
            headers: {
              apikey: evoApiKey!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(evoBody),
          });
          result = await response.json().catch(() => ({}));
        }

        console.log(`[BATCH-SEND] Response ${response.status}: ${JSON.stringify(result).slice(0, 500)}`);

        const externalId =
          provider === "meta"
            ? result?.messages?.[0]?.id
            : result?.key?.id || result?.id;

        if (response.ok && externalId) {
          await supabase
            .from("whatsapp_message_queue")
            .update({ status: "sent", external_message_id: externalId })
            .eq("id", msg.id);
          sent++;
        } else {
          await supabase
            .from("whatsapp_message_queue")
            .update({ status: "failed", error_message: JSON.stringify(result?.error || result || { status: response.status }) })
            .eq("id", msg.id);
          failed++;
        }
      } catch (err) {
        await supabase
          .from("whatsapp_message_queue")
          .update({ status: "failed", error_message: String(err) })
          .eq("id", msg.id);
        failed++;
      }
    }

    return new Response(JSON.stringify({ processed: messages.length, sent, failed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Send message error:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

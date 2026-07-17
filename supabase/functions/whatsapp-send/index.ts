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

    // Meta credentials (with legacy fallback + platform-managed permanent token)
    const metaAccessToken = waConfig.meta?.access_token || waConfig.access_token || Deno.env.get("META_PERMANENT_TOKEN");
    let metaPhoneNumberId: string | null = waConfig.meta?.phone_number_id || null;

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

        const mediaUrl: string | null = msg.media_url || null;
        const mediaType: string | null = msg.media_type || null; // "image" | "video" | "document"
        const mediaFilename: string | null = msg.media_filename || null;

        let waBody: Record<string, unknown>;
        if (msg.template_name) {
          // Map media as header parameter for templates that declare a header
          let components: any[] = Array.isArray(msg.template_params) ? [...msg.template_params] : [];
          if (mediaUrl && mediaType) {
            const headerParam =
              mediaType === "image" ? { type: "image", image: { link: mediaUrl } } :
              mediaType === "video" ? { type: "video", video: { link: mediaUrl } } :
              { type: "document", document: { link: mediaUrl, filename: mediaFilename || "document.pdf" } };
            const hasHeader = components.some((c: any) => (c?.type || "").toLowerCase() === "header");
            if (!hasHeader) {
              components = [{ type: "header", parameters: [headerParam] }, ...components];
            }
          }
          waBody = {
            messaging_product: "whatsapp",
            to: msg.recipient_phone,
            type: "template",
            template: {
              name: msg.template_name,
              language: { code: "en" },
              components,
            },
          };
        } else if (mediaUrl && mediaType) {
          // Direct media message
          const metaType = mediaType === "image" ? "image" : mediaType === "video" ? "video" : "document";
          const mediaPayload: Record<string, unknown> = { link: mediaUrl };
          if (renderedContent) (mediaPayload as any).caption = renderedContent;
          if (metaType === "document") (mediaPayload as any).filename = mediaFilename || "document.pdf";
          waBody = {
            messaging_product: "whatsapp",
            to: msg.recipient_phone,
            type: metaType,
            [metaType]: mediaPayload,
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
        const response = await fetch(metaUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${metaAccessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(waBody),
        });
        const result = await response.json();

        console.log(`[BATCH-SEND] Response ${response.status}: ${JSON.stringify(result).slice(0, 500)}`);

        const externalId = result?.messages?.[0]?.id;

        if (response.ok && externalId) {
          await supabase
            .from("whatsapp_message_queue")
            .update({ status: "sent", external_message_id: externalId })
            .eq("id", msg.id);
          if (msg.campaign_recipient_id) {
            await supabase
              .from("campaign_recipients")
              .update({ status: "sent", sent_at: new Date().toISOString(), error_message: null })
              .eq("id", msg.campaign_recipient_id);
          }
          sent++;
        } else {
          const errMsg = (() => {
            const e = result?.error || result;
            if (!e) return `HTTP ${response.status}`;
            if (typeof e === "string") return e;
            return e.message || e.error?.message || JSON.stringify(e).slice(0, 400);
          })();
          await supabase
            .from("whatsapp_message_queue")
            .update({ status: "failed", error_message: errMsg })
            .eq("id", msg.id);
          if (msg.campaign_recipient_id) {
            await supabase
              .from("campaign_recipients")
              .update({ status: "failed", error_message: errMsg })
              .eq("id", msg.campaign_recipient_id);
          }
          failed++;
        }
      } catch (err) {
        const errStr = String(err).slice(0, 400);
        await supabase
          .from("whatsapp_message_queue")
          .update({ status: "failed", error_message: errStr })
          .eq("id", msg.id);
        if (msg.campaign_recipient_id) {
          await supabase
            .from("campaign_recipients")
            .update({ status: "failed", error_message: errStr })
            .eq("id", msg.campaign_recipient_id);
        }
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

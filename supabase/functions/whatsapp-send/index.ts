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
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { tenant_id, max_batch } = await req.json();

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: "tenant_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get tenant's WhatsApp config
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

    // Get tenant's WhatsApp access token from tenant settings
    const { data: tenant } = await supabase
      .from("tenants")
      .select("whatsapp_config")
      .eq("id", tenant_id)
      .single();

    const waConfig = tenant?.whatsapp_config as Record<string, string> | null;
    const accessToken = waConfig?.access_token;

    if (!accessToken) {
      return new Response(JSON.stringify({ error: "WhatsApp access token not configured" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch queued messages
    const batchSize = max_batch || 10;
    const { data: messages } = await supabase
      .from("whatsapp_message_queue")
      .select("*")
      .eq("tenant_id", tenant_id)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let failed = 0;

    for (const msg of messages) {
      // Mark as sending
      await supabase
        .from("whatsapp_message_queue")
        .update({ status: "sending", attempts: msg.attempts + 1, last_attempt_at: new Date().toISOString() })
        .eq("id", msg.id);

      try {
        let waBody: Record<string, unknown>;

        if (msg.template_name) {
          // Template message
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
          // Text message
          waBody = {
            messaging_product: "whatsapp",
            to: msg.recipient_phone,
            type: "text",
            text: { body: msg.content },
          };
        }

        const response = await fetch(
          `https://graph.facebook.com/v18.0/${session.phone_number_id}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(waBody),
          }
        );

        const result = await response.json();

        if (response.ok && result.messages?.[0]?.id) {
          await supabase
            .from("whatsapp_message_queue")
            .update({ status: "sent", external_message_id: result.messages[0].id })
            .eq("id", msg.id);
          sent++;
        } else {
          await supabase
            .from("whatsapp_message_queue")
            .update({ status: "failed", error_message: JSON.stringify(result.error || result) })
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

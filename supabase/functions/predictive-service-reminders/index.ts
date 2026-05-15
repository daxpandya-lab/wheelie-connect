import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cron-driven. Finds service bookings whose `completed_at` is ~6 months ago
// and that have not yet received a predictive reminder. Sends a WhatsApp
// message inviting the customer to schedule preventive maintenance.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 6-month window: bookings completed between 6mo+7d ago and 6mo ago
    const now = Date.now();
    const sixMonthsMs = 182 * 24 * 3600 * 1000;
    const windowMs = 7 * 24 * 3600 * 1000;
    const since = new Date(now - sixMonthsMs - windowMs).toISOString();
    const until = new Date(now - sixMonthsMs).toISOString();

    const { data: bookings, error } = await supabase
      .from("service_bookings")
      .select("id, tenant_id, customer_name, phone_number, vehicle_model, metadata, completed_at")
      .eq("status", "completed")
      .is("predictive_reminder_sent_at", null)
      .gte("completed_at", since)
      .lte("completed_at", until)
      .limit(100);

    if (error) {
      console.error("[predictive] query error", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!bookings?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    for (const b of bookings) {
      if (!b.phone_number) continue;
      try {
        const { data: tenant } = await supabase
          .from("tenants").select("whatsapp_config, status").eq("id", b.tenant_id).single();
        if (!tenant || tenant.status !== "active") continue;

        const wa = (tenant.whatsapp_config as Record<string, any>) || {};
        const provider: "meta" | "evolution" = wa.provider === "evolution" ? "evolution" : "meta";

        const vehicleNo = String(
          (b.metadata as Record<string, any> | null)?.vehicle_number ||
          (b.metadata as Record<string, any> | null)?.license_plate ||
          b.vehicle_model || "your vehicle",
        );
        const firstName = (b.customer_name || "there").split(" ")[0];
        const text = `Hi ${firstName}, it has been 6 months since your last service for ${vehicleNo}. Would you like to schedule your next preventive maintenance visit?`;

        let ok = false;
        if (provider === "evolution" && wa.evolution?.instance_url && wa.evolution?.api_key && wa.evolution?.instance_name) {
          const r = await fetch(
            `${wa.evolution.instance_url}/message/sendText/${encodeURIComponent(wa.evolution.instance_name)}`,
            {
              method: "POST",
              headers: { apikey: wa.evolution.api_key, "Content-Type": "application/json" },
              body: JSON.stringify({ number: b.phone_number, text }),
            },
          );
          ok = r.ok;
        } else if (provider === "meta" && wa.meta?.phone_number_id && (wa.meta?.access_token || wa.access_token)) {
          const token = wa.meta?.access_token || wa.access_token;
          const r = await fetch(`https://graph.facebook.com/v21.0/${wa.meta.phone_number_id}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp", to: b.phone_number,
              type: "text", text: { body: text },
            }),
          });
          ok = r.ok;
        }

        if (ok) {
          await supabase.from("service_bookings")
            .update({ predictive_reminder_sent_at: new Date().toISOString() })
            .eq("id", b.id);
          sent++;
        }
      } catch (e) {
        console.error("[predictive] send failed", b.id, e);
      }
    }

    return new Response(JSON.stringify({ processed: bookings.length, sent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("predictive-service-reminders", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

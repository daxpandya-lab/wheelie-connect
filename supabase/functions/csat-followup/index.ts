import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Triggered by cron. Finds completed service bookings ~24h old without csat_sent_at,
// then sends a WhatsApp CSAT prompt with rating buttons (1-5).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const until = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const { data: bookings } = await supabase
      .from("service_bookings")
      .select("id, tenant_id, customer_name, phone_number, vehicle_model, updated_at, csat_sent_at, status")
      .eq("status", "completed")
      .is("csat_sent_at", null)
      .gte("updated_at", since)
      .lte("updated_at", until)
      .limit(50);

    if (!bookings?.length) {
      return new Response(JSON.stringify({ processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let sent = 0;
    for (const b of bookings) {
      if (!b.phone_number) continue;
      const { data: tenant } = await supabase.from("tenants").select("whatsapp_config").eq("id", b.tenant_id).single();
      const wa = (tenant?.whatsapp_config as Record<string, any>) || {};
      const provider: "meta" | "evolution" = wa.provider === "evolution" ? "evolution" : "meta";
      const text = `Hi ${b.customer_name?.split(" ")[0] || "there"}, how is your ${b.vehicle_model} performing after the service? Please rate us 1-5.`;

      try {
        if (provider === "evolution" && wa.evolution?.instance_url && wa.evolution?.api_key && wa.evolution?.instance_name) {
          await fetch(`${wa.evolution.instance_url}/message/sendButtons/${encodeURIComponent(wa.evolution.instance_name)}`, {
            method: "POST",
            headers: { apikey: wa.evolution.api_key, "Content-Type": "application/json" },
            body: JSON.stringify({
              number: b.phone_number,
              title: "How was your service?",
              description: text,
              footer: "Tap a star rating",
              buttons: [1, 2, 3, 4, 5].map((n) => ({
                type: "reply", displayText: `${n} ⭐`, id: `csat_${n}_${b.id}`,
              })),
            }),
          });
          sent++;
        } else if (provider === "meta" && wa.meta?.phone_number_id && (wa.meta?.access_token || wa.access_token)) {
          const token = wa.meta?.access_token || wa.access_token;
          // Meta supports max 3 reply buttons; use 3 quick + ask reply for rest
          await fetch(`https://graph.facebook.com/v21.0/${wa.meta.phone_number_id}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp", to: b.phone_number, type: "interactive",
              interactive: {
                type: "button", body: { text },
                action: {
                  buttons: [
                    { type: "reply", reply: { id: `csat_5_${b.id}`, title: "5 ⭐" } },
                    { type: "reply", reply: { id: `csat_4_${b.id}`, title: "4 ⭐" } },
                    { type: "reply", reply: { id: `csat_1_${b.id}`, title: "1-3 ⭐" } },
                  ],
                },
              },
            }),
          });
          sent++;
        }
        await supabase.from("service_bookings").update({ csat_sent_at: new Date().toISOString() }).eq("id", b.id);
      } catch (e) {
        console.error("csat send failed for", b.id, e);
      }
    }

    return new Response(JSON.stringify({ processed: bookings.length, sent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("csat-followup", e);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

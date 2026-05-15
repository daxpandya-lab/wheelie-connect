import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// CSAT prompt 24h after a booking is marked completed.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const since = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
    const until = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const { data: bookings } = await supabase
      .from("service_bookings")
      .select("id, tenant_id, customer_name, phone_number, vehicle_model, booking_source, csat_sent_at, status")
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
      const text = `Hi ${b.customer_name?.split(" ")[0] || "there"}, how is your ${b.vehicle_model} performing after the service? Please rate us 1-5.`;
      const result = await dispatchNotification(
        supabase,
        {
          tenantId: b.tenant_id,
          bookingId: b.id,
          bookingSource: b.booking_source,
          phoneNumber: b.phone_number,
        },
        {
          kind: "buttons",
          text,
          buttons: [
            { id: `csat_5_${b.id}`, title: "5 ⭐" },
            { id: `csat_4_${b.id}`, title: "4 ⭐" },
            { id: `csat_1_${b.id}`, title: "1-3 ⭐" },
          ],
        },
      );
      if (result.status === "sent") {
        await supabase.from("service_bookings").update({ csat_sent_at: new Date().toISOString() }).eq("id", b.id);
        sent++;
      } else if (result.status === "failed") {
        console.warn("csat dispatch failed", b.id, result.error);
      }
    }

    return new Response(JSON.stringify({ processed: bookings.length, sent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("csat-followup", e);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

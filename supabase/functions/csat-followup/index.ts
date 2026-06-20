import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Per-tenant CSAT prompt after a booking is marked completed/delivered.
// Honors tenants.settings.post_service_feedback = { enabled, delay_hours: 24|48 }.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tenants } = await supabase
      .from("tenants").select("id, settings").eq("status", "active");
    if (!tenants?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalProcessed = 0;
    let totalSent = 0;
    const windowHours = 12; // tolerance window for catch-up runs

    for (const t of tenants) {
      const cfg = ((t.settings as any)?.post_service_feedback ?? {}) as {
        enabled?: boolean;
        delay_hours?: number;
      };
      const enabled = cfg.enabled !== false; // default ON
      if (!enabled) continue;
      const delayH = cfg.delay_hours === 48 ? 48 : 24;

      const until = new Date(Date.now() - delayH * 3600 * 1000).toISOString();
      const since = new Date(Date.now() - (delayH + windowHours) * 3600 * 1000).toISOString();

      const { data: bookings } = await supabase
        .from("service_bookings")
        .select("id, tenant_id, customer_name, phone_number, vehicle_model, booking_source, csat_sent_at, status, updated_at")
        .eq("tenant_id", t.id)
        .eq("status", "completed")
        .is("csat_sent_at", null)
        .gte("updated_at", since)
        .lte("updated_at", until)
        .limit(50);
      if (!bookings?.length) continue;

      totalProcessed += bookings.length;
      for (const b of bookings) {
        if (!b.phone_number) continue;
        const firstName = (b.customer_name || "there").split(" ")[0];
        const text = `Hi ${firstName}, how was your ${b.vehicle_model || "service"} experience with us? Please rate us 1-5 ⭐`;
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
          await supabase.from("service_bookings")
            .update({ csat_sent_at: new Date().toISOString() }).eq("id", b.id);
          totalSent++;
        } else if (result.status === "failed") {
          console.warn("csat dispatch failed", b.id, result.error);
        }
      }
    }

    return new Response(JSON.stringify({ processed: totalProcessed, sent: totalSent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("csat-followup", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cron-driven. Reads each tenant's predictive-reminder configuration from
// `tenants.settings.predictive_service_reminder` ({ enabled, interval_months })
// and only flags + notifies bookings that fall in the configured window.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Pull active tenants and group their predictive-reminder settings.
    const { data: tenants, error: tErr } = await supabase
      .from("tenants")
      .select("id, settings")
      .eq("status", "active");
    if (tErr) {
      return new Response(JSON.stringify({ error: tErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!tenants?.length) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalSent = 0;
    let totalProcessed = 0;
    const windowDays = 7;

    for (const t of tenants) {
      const cfg = ((t.settings as Record<string, any> | null)?.predictive_service_reminder ?? {}) as {
        enabled?: boolean;
        interval_months?: number;
      };
      // Default ON at 6 months unless the dealer has explicitly opted out.
      const enabled = cfg.enabled !== false;
      const months = Math.max(1, Math.min(36, Number(cfg.interval_months ?? 6) || 6));
      if (!enabled) continue;

      const now = Date.now();
      const intervalMs = Math.round(months * 30.4375 * 24 * 3600 * 1000);
      const since = new Date(now - intervalMs - windowDays * 86400000).toISOString();
      const until = new Date(now - intervalMs).toISOString();

      const { data: bookings, error } = await supabase
        .from("service_bookings")
        .select("id, tenant_id, customer_name, phone_number, vehicle_model, metadata, completed_at, booking_source")
        .eq("tenant_id", t.id)
        .eq("status", "completed")
        .is("predictive_reminder_sent_at", null)
        .gte("completed_at", since)
        .lte("completed_at", until)
        .limit(100);
      if (error) { console.error("[predictive] query", t.id, error); continue; }
      if (!bookings?.length) continue;

      totalProcessed += bookings.length;
      for (const b of bookings) {
        if (!b.phone_number) continue;
        const vehicleNo = String(
          (b.metadata as Record<string, any> | null)?.vehicle_number ||
          (b.metadata as Record<string, any> | null)?.license_plate ||
          b.vehicle_model || "your vehicle",
        );
        const firstName = (b.customer_name || "there").split(" ")[0];
        const text = `Hi ${firstName}, it has been ${months} months since your last service for ${vehicleNo}. Would you like to schedule your next preventive maintenance visit?`;

        const result = await dispatchNotification(
          supabase,
          {
            tenantId: b.tenant_id,
            bookingId: b.id,
            bookingSource: b.booking_source,
            phoneNumber: b.phone_number,
          },
          { kind: "text", text },
        );

        if (result.status === "sent") {
          await supabase
            .from("service_bookings")
            .update({ predictive_reminder_sent_at: new Date().toISOString() })
            .eq("id", b.id);
          totalSent++;
        } else if (result.status === "failed") {
          console.warn("[predictive] dispatch failed", b.id, result.error);
        }
      }
    }

    return new Response(JSON.stringify({ processed: totalProcessed, sent: totalSent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("predictive-service-reminders", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

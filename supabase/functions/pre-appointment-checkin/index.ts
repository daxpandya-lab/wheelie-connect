import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { dispatchNotification, logOutbound } from "../_shared/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cron-driven: runs hourly. For every active tenant, finds confirmed/pending
// service bookings scheduled for tomorrow that have NOT yet received the 24h
// check-in message, and dispatches an interactive WhatsApp/web-bot payload
// with three quick replies + a Google Maps directions link.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tenants, error: tErr } = await supabase
      .from("tenants")
      .select("id, name, settings")
      .eq("status", "active");
    if (tErr) {
      return new Response(JSON.stringify({ error: tErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalSent = 0;
    let totalProcessed = 0;

    for (const t of tenants ?? []) {
      const settings = (t.settings as Record<string, any>) || {};
      const mapsUrl = String(settings.google_maps_url || settings.directions_url || "").trim();

      // Per-tenant dynamic lead time (hours). Default 24h. Disable opt-out honored.
      const checkinCfg = (settings.pre_appointment_checkin as Record<string, any>) || {};
      if (checkinCfg.enabled === false) continue;
      const leadHours = Number(checkinCfg.lead_time_hours ?? 24);
      const leadDays = Math.max(0, Math.ceil(leadHours / 24));

      const target = new Date();
      target.setUTCDate(target.getUTCDate() + leadDays);
      const targetIso = target.toISOString().slice(0, 10);

      const { data: bookings, error } = await supabase
        .from("service_bookings")
        .select("id, tenant_id, customer_name, phone_number, vehicle_model, booking_source, preferred_time")
        .eq("tenant_id", t.id)
        .eq("booking_date", targetIso)
        .is("checkin_sent_at", null)
        .in("status", ["pending", "confirmed", "estimation_sent"])
        .limit(200);

      if (error) { console.error("[checkin] query", t.id, error); continue; }
      if (!bookings?.length) continue;
      totalProcessed += bookings.length;

      for (const b of bookings) {
        if (!b.phone_number) continue;
        const firstName = (b.customer_name || "there").split(" ")[0];
        const vehicle = b.vehicle_model || "your vehicle";
        const timeStr = b.preferred_time ? ` at ${b.preferred_time}` : "";
        let body =
          `Hi ${firstName} 👋\n\nThis is a friendly reminder about your service appointment tomorrow${timeStr} for your ${vehicle}.\n\n` +
          `Need to make any changes? Just tap below:`;
        if (mapsUrl) body += `\n\n📍 Get Directions to Workshop: ${mapsUrl}`;

        const allowCancellations = checkinCfg.allow_cancellations !== false;
        let reminderBody = body;
        if (!allowCancellations) {
          reminderBody = reminderBody.replace(/\n\nNeed to make any changes\?[^\n]*/i, "\n\nWant to share anything ahead of your visit?");
        }

        const buttons = [
          { id: `chk_comments_${b.id}`, title: "📝 Add Comments" },
          { id: `chk_photos_${b.id}`,   title: "📸 Upload Photos" },
        ];
        if (allowCancellations) {
          buttons.push({ id: `chk_cancel_${b.id}`, title: "❌ Cancel" });
        }

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
            text: reminderBody,
            buttons,
          },
        );

        if (result.status === "sent") {
          await supabase
            .from("service_bookings")
            .update({ checkin_sent_at: new Date().toISOString() })
            .eq("id", b.id);
          await logOutbound(supabase, {
            tenantId: b.tenant_id,
            customerPhone: b.phone_number,
            automationType: "pre_appointment_checkin",
            channel: result.channel,
            status: "sent",
            payload: { booking_id: b.id, booking_date: targetIso, lead_hours: leadHours },
          });
          totalSent++;
        } else if (result.status === "failed") {
          await logOutbound(supabase, {
            tenantId: b.tenant_id,
            customerPhone: b.phone_number,
            automationType: "pre_appointment_checkin",
            channel: result.channel,
            status: "failed",
            errorMessage: result.error,
          });
        }
      }
    }

    return new Response(JSON.stringify({ processed: totalProcessed, sent: totalSent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pre-appointment-checkin", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

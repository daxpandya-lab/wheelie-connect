import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/notify.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cron-driven: detect customers who abandoned a chatbot booking mid-flow
// and fire a WhatsApp recovery prompt with [Resume Booking] / [Cancel & End]
// after tenants.settings.chat_drop_off_recovery.timeout_minutes of silence.
//
// Phone is read from chat_sessions.collected_data (customer_phone | phone | phone_number).
// We mark sessions with collected_data._dropoff_recovery_sent_at to avoid re-sends.
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
    const maxAgeMs = 24 * 3600 * 1000; // don't recover sessions older than 24h

    for (const t of tenants) {
      const cfg = ((t.settings as any)?.chat_drop_off_recovery ?? {}) as {
        enabled?: boolean; timeout_minutes?: number;
      };
      const enabled = cfg.enabled !== false; // default ON
      if (!enabled) continue;
      const timeoutMin = [15, 30, 60, 120].includes(Number(cfg.timeout_minutes))
        ? Number(cfg.timeout_minutes) : 30;

      const until = new Date(Date.now() - timeoutMin * 60_000).toISOString();
      const since = new Date(Date.now() - maxAgeMs).toISOString();

      const { data: sessions } = await supabase
        .from("chat_sessions")
        .select("id, tenant_id, collected_data, updated_at, is_complete")
        .eq("tenant_id", t.id)
        .eq("is_complete", false)
        .gte("updated_at", since)
        .lte("updated_at", until)
        .limit(50);
      if (!sessions?.length) continue;

      for (const s of sessions) {
        const data = (s.collected_data as Record<string, any> | null) || {};
        if (data._dropoff_recovery_sent_at) continue;
        const phone = String(
          data.customer_phone || data.phone || data.phone_number || ""
        ).trim();
        if (!phone) continue;
        totalProcessed++;
        const firstName = String(data.customer_name || data.name || "there").split(" ")[0];
        const text = `Hi ${firstName}, looks like your booking was interrupted. Would you like to pick up where you left off?`;

        const result = await dispatchNotification(
          supabase,
          { tenantId: s.tenant_id, phoneNumber: phone, bookingSource: "chatbot" },
          {
            kind: "buttons",
            text,
            buttons: [
              { id: `resume_${s.id}`, title: "📅 Resume Booking" },
              { id: `cancel_${s.id}`, title: "❌ Cancel & End" },
            ],
          },
        );
        if (result.status === "sent") {
          await supabase.from("chat_sessions").update({
            collected_data: { ...data, _dropoff_recovery_sent_at: new Date().toISOString() },
          } as any).eq("id", s.id);
          totalSent++;
        } else if (result.status === "failed") {
          console.warn("[dropoff] dispatch failed", s.id, result.error);
        }
      }
    }

    return new Response(JSON.stringify({ processed: totalProcessed, sent: totalSent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat-dropoff-recovery", e);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

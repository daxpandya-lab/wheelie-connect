import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const bookingId = typeof body.booking_id === "string" ? body.booking_id : null;
    const amount = Number(body.amount);
    const notes = String(body.notes || "");
    const parts = String(body.parts || "");
    if (!bookingId || !/^[0-9a-f-]{36}$/.test(bookingId)) {
      return new Response(JSON.stringify({ error: "Valid booking_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return new Response(JSON.stringify({ error: "Valid amount required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: booking, error: bErr } = await supabase
      .from("service_bookings")
      .select("id, tenant_id, customer_name, phone_number, vehicle_model, booking_source")
      .eq("id", bookingId).maybeSingle();
    if (bErr || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verify caller belongs to tenant
    const { data: profile } = await userClient.from("profiles").select("tenant_id").eq("user_id", claims.claims.sub).maybeSingle();
    if (!profile || profile.tenant_id !== booking.tenant_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Persist estimate
    const { error: upErr } = await supabase
      .from("service_bookings")
      .update({
        estimate_amount: amount,
        estimated_cost: amount,
        work_notes: notes || null,
        parts_required: parts || null,
        approval_status: "pending",
        status: "estimation_sent",
        estimation_sent_at: new Date().toISOString(),
      })
      .eq("id", bookingId);
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build the estimate text for both channels
    const vehicle = booking.vehicle_model || "your vehicle";
    const formattedAmount = `₹${amount.toLocaleString("en-IN")}`;
    const text = [
      `🛠️ *Service Estimation*`,
      ``,
      `Vehicle: ${vehicle}`,
      `Labor / Service: ${formattedAmount}`,
      notes ? `Work Notes: ${notes}` : null,
      parts ? `Parts Required: ${parts}` : null,
      ``,
      `Please choose an option below:`,
    ].filter(Boolean).join("\n");

    // Build the public estimate URL (used as the Web Bot rich card link)
    const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/[^/]*$/, "") || "";
    const estimateUrl = origin ? `${origin}/estimate/${bookingId}` : `/estimate/${bookingId}`;

    let whatsappStatus: "sent" | "skipped" | "failed" = "skipped";
    let whatsappError: string | undefined;

    if (booking.phone_number) {
      const { data: tenantData } = await supabase.from("tenants").select("whatsapp_config").eq("id", booking.tenant_id).single();
      const wa = (tenantData?.whatsapp_config as Record<string, any>) || {};
      const provider: "meta" | "evolution" = wa.provider === "evolution" ? "evolution" : "meta";

      try {
        if (provider === "evolution") {
          const evoUrl = wa.evolution?.instance_url;
          const evoInstance = wa.evolution?.instance_name;
          const evoApiKey = wa.evolution?.api_key;
          if (evoUrl && evoInstance && evoApiKey) {
            const endpoint = `${evoUrl}/message/sendButtons/${encodeURIComponent(evoInstance)}`;
            const evoBody = {
              number: booking.phone_number,
              title: "Service Estimation",
              description: text,
              footer: "Reply by tapping a button",
              buttons: [
                { type: "reply", displayText: "✅ Approve Work", id: `est_approve_${bookingId}` },
                { type: "reply", displayText: "📞 Reject / Call Me", id: `est_reject_${bookingId}` },
              ],
            };
            const r = await fetch(endpoint, {
              method: "POST",
              headers: { apikey: evoApiKey, "Content-Type": "application/json" },
              body: JSON.stringify(evoBody),
            });
            if (r.ok) whatsappStatus = "sent";
            else { whatsappStatus = "failed"; whatsappError = (await r.text()).slice(0, 500); }
          }
        } else {
          const accessToken = wa.meta?.access_token || wa.access_token;
          const phoneNumberId = wa.meta?.phone_number_id;
          if (accessToken && phoneNumberId) {
            const endpoint = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
            const metaBody = {
              messaging_product: "whatsapp",
              to: booking.phone_number,
              type: "interactive",
              interactive: {
                type: "button",
                body: { text },
                action: {
                  buttons: [
                    { type: "reply", reply: { id: `est_approve_${bookingId}`, title: "Approve Work" } },
                    { type: "reply", reply: { id: `est_reject_${bookingId}`, title: "Reject / Call Me" } },
                  ],
                },
              },
            };
            const r = await fetch(endpoint, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify(metaBody),
            });
            if (r.ok) whatsappStatus = "sent";
            else { whatsappStatus = "failed"; whatsappError = (await r.text()).slice(0, 500); }
          }
        }
      } catch (e) {
        whatsappStatus = "failed";
        whatsappError = String(e).slice(0, 500);
      }
    }

    return new Response(
      JSON.stringify({ success: true, whatsapp: whatsappStatus, whatsapp_error: whatsappError, estimate_url: estimateUrl }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-service-estimate error", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

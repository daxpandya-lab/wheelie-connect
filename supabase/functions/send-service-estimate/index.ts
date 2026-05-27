import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/notify.ts";

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
      .select("id, tenant_id, customer_name, phone_number, vehicle_model, booking_source, status")
      .eq("id", bookingId).maybeSingle();
    if (bErr || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: profile } = await userClient.from("profiles").select("tenant_id").eq("user_id", claims.claims.sub).maybeSingle();
    if (!profile || profile.tenant_id !== booking.tenant_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Atomic transition: locks the row, validates the source state.
    const { error: rpcErr } = await supabase.rpc("transition_service_booking_status", {
      _booking_id: bookingId,
      _expected_status: booking.status,
      _new_status: "estimation_sent",
      _patch: {
        estimate_amount: amount,
        estimated_cost: amount,
        work_notes: notes || null,
        parts_required: parts || null,
        approval_status: "pending",
        estimation_sent_at: new Date().toISOString(),
      },
    } as never);
    if (rpcErr) {
      const status = String(rpcErr.message || "").includes("Stale status") ? 409 : 400;
      return new Response(JSON.stringify({ error: rpcErr.message }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Reset customer-side approval state when (re-)sending an estimate
    await supabase
      .from("service_bookings")
      .update({ customer_approval_status: "pending_approval" })
      .eq("id", bookingId);

    // Seed parts suggestion library; RPC increments usage_count and dedupes near-spellings.
    if (parts && parts.trim()) {
      const parsed = Array.from(new Set(
        parts.split(/[,;\n]/).map((p) => p.trim()).filter((p) => p.length > 0 && p.length < 80),
      ));
      for (const part_name of parsed) {
        await supabase.rpc("upsert_part_suggestion", {
          _tenant_id: booking.tenant_id,
          _part_name: part_name,
        } as never);
      }
    }



    const vehicle = booking.vehicle_model || "your vehicle";
    const formattedAmount = `₹${amount.toLocaleString("en-IN")}`;
    const text = [
      `🛠️ *Service Estimation*`, ``,
      `Vehicle: ${vehicle}`,
      `Labor / Service: ${formattedAmount}`,
      notes ? `Work Notes: ${notes}` : null,
      parts ? `Parts Required: ${parts}` : null,
      ``, `Please choose an option below:`,
    ].filter(Boolean).join("\n");

    const origin = req.headers.get("origin") || req.headers.get("referer")?.replace(/\/[^/]*$/, "") || "";
    const estimateUrl = origin ? `${origin}/estimate/${bookingId}` : `/estimate/${bookingId}`;

    const result = await dispatchNotification(
      supabase,
      {
        tenantId: booking.tenant_id,
        bookingId,
        bookingSource: booking.booking_source,
        phoneNumber: booking.phone_number,
      },
      {
        kind: "buttons",
        text,
        buttons: [
          { id: `est_approve_${bookingId}`, title: "✅ Approve" },
          { id: `est_reject_${bookingId}`, title: "❌ Reject" },
          { id: `est_call_${bookingId}`, title: "📞 Call Me" },
        ],
      },
    );


    return new Response(
      JSON.stringify({
        success: true,
        channel: result.channel,
        whatsapp: result.status,
        whatsapp_error: result.error,
        estimate_url: estimateUrl,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-service-estimate error", err);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

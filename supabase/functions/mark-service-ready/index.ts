import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

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
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const bookingId = String(body.booking_id || "");
    const amount = Number(body.amount);
    if (!/^[0-9a-f-]{36}$/.test(bookingId) || !Number.isFinite(amount) || amount < 0) {
      return new Response(JSON.stringify({ error: "Valid booking_id and amount required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: booking } = await supabase
      .from("service_bookings")
      .select("id, tenant_id, customer_name, phone_number, vehicle_model, service_type, booking_date, estimate_amount, work_notes, parts_required, booking_source, status")
      .eq("id", bookingId).maybeSingle();
    if (!booking) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: profile } = await userClient.from("profiles").select("tenant_id").eq("user_id", claims.claims.sub).maybeSingle();
    if (!profile || profile.tenant_id !== booking.tenant_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: tenant } = await supabase.from("tenants").select("name, whatsapp_config").eq("id", booking.tenant_id).single();

    // Build pro-forma invoice PDF
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let y = 800;
    const draw = (t: string, opts: { x?: number; size?: number; b?: boolean } = {}) => {
      page.drawText(t, { x: opts.x ?? 50, y, size: opts.size ?? 11, font: opts.b ? bold : font, color: rgb(0.1, 0.1, 0.15) });
    };
    draw(tenant?.name || "Service Center", { size: 18, b: true }); y -= 28;
    draw("PRO-FORMA INVOICE", { size: 13, b: true }); y -= 24;
    draw(`Booking ID: ${booking.id.slice(0, 8).toUpperCase()}`); y -= 16;
    draw(`Date: ${new Date().toLocaleDateString("en-IN")}`); y -= 24;
    draw("Customer", { b: true }); y -= 16;
    draw(`Name: ${booking.customer_name}`); y -= 14;
    draw(`Phone: ${booking.phone_number}`); y -= 14;
    draw(`Vehicle: ${booking.vehicle_model}`); y -= 24;
    draw("Service Details", { b: true }); y -= 16;
    draw(`Service Type: ${booking.service_type || "-"}`); y -= 14;
    if (booking.work_notes) { draw(`Work: ${String(booking.work_notes).slice(0, 80)}`); y -= 14; }
    if (booking.parts_required) { draw(`Parts: ${String(booking.parts_required).slice(0, 80)}`); y -= 14; }
    y -= 16;
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.7, 0.7, 0.7) }); y -= 24;
    draw("Total Amount", { b: true });
    page.drawText(`Rs. ${amount.toLocaleString("en-IN")}`, { x: 450, y, size: 12, font: bold }); y -= 30;
    draw("Payable at the service counter on pickup.", { size: 9 });
    const pdfBytes = await pdf.save();

    // Upload to storage
    const path = `${booking.tenant_id}/${bookingId}-${Date.now()}.pdf`;
    const { error: upErr } = await supabase.storage.from("service_invoices").upload(path, pdfBytes, {
      contentType: "application/pdf", upsert: true,
    });
    if (upErr) {
      return new Response(JSON.stringify({ error: `Upload failed: ${upErr.message}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: pub } = supabase.storage.from("service_invoices").getPublicUrl(path);
    const invoiceUrl = pub.publicUrl;

    // Update booking
    await supabase.from("service_bookings").update({
      status: "ready_for_pickup",
      total_amount: amount,
      ready_at: new Date().toISOString(),
    }).eq("id", bookingId);

    // Send WhatsApp message + PDF document
    const wa = (tenant?.whatsapp_config as Record<string, any>) || {};
    const provider: "meta" | "evolution" = wa.provider === "evolution" ? "evolution" : "meta";
    const text = `🚗 Your vehicle ${booking.vehicle_model} is ready! Total Amount: ₹${amount.toLocaleString("en-IN")}. You can pay at the counter.`;
    let waStatus: "sent" | "skipped" | "failed" = "skipped";
    let waError: string | undefined;

    if (booking.phone_number) {
      try {
        if (provider === "evolution" && wa.evolution?.instance_url && wa.evolution?.instance_name && wa.evolution?.api_key) {
          const base = `${wa.evolution.instance_url}/message`;
          const headers = { apikey: wa.evolution.api_key, "Content-Type": "application/json" };
          // Send text
          await fetch(`${base}/sendText/${encodeURIComponent(wa.evolution.instance_name)}`, {
            method: "POST", headers, body: JSON.stringify({ number: booking.phone_number, text }),
          });
          // Send PDF document
          const r = await fetch(`${base}/sendMedia/${encodeURIComponent(wa.evolution.instance_name)}`, {
            method: "POST", headers,
            body: JSON.stringify({
              number: booking.phone_number,
              mediatype: "document",
              fileName: `invoice-${bookingId.slice(0, 8)}.pdf`,
              media: invoiceUrl,
              caption: "Pro-forma Invoice",
            }),
          });
          waStatus = r.ok ? "sent" : "failed";
          if (!r.ok) waError = (await r.text()).slice(0, 300);
        } else if (provider === "meta" && (wa.meta?.access_token || wa.access_token) && wa.meta?.phone_number_id) {
          const token = wa.meta?.access_token || wa.access_token;
          const endpoint = `https://graph.facebook.com/v21.0/${wa.meta.phone_number_id}/messages`;
          await fetch(endpoint, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", to: booking.phone_number, type: "text", text: { body: text } }),
          });
          const r = await fetch(endpoint, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp", to: booking.phone_number, type: "document",
              document: { link: invoiceUrl, filename: `invoice-${bookingId.slice(0, 8)}.pdf`, caption: "Pro-forma Invoice" },
            }),
          });
          waStatus = r.ok ? "sent" : "failed";
          if (!r.ok) waError = (await r.text()).slice(0, 300);
        }
      } catch (e) {
        waStatus = "failed"; waError = String(e).slice(0, 300);
      }
    }

    return new Response(JSON.stringify({ success: true, invoice_url: invoiceUrl, whatsapp: waStatus, whatsapp_error: waError }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("mark-service-ready", e);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

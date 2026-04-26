import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReminderRow {
  id: string;
  tenant_id: string;
  rule_id: string;
  booking_type: "service" | "test_drive";
  booking_id: string;
  scheduled_for: string;
  recipient_phone: string;
  attempts: number;
  rule: {
    template_name: string | null;
    message_body: string | null;
    stop_on_statuses: string[];
  } | null;
}

function renderTemplate(
  body: string,
  vars: Record<string, string | null | undefined>,
): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 100), 1),
    500,
  );

  const nowIso = new Date().toISOString();

  const { data: due, error: dueErr } = await supabase
    .from("booking_reminders")
    .select(
      `id, tenant_id, rule_id, booking_type, booking_id, scheduled_for,
       recipient_phone, attempts,
       rule:booking_reminder_rules!inner (
         template_name, message_body, stop_on_statuses
       )`,
    )
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(limit)
    .returns<ReminderRow[]>();

  if (dueErr) {
    console.error("[dispatch-reminders] fetch error", dueErr);
    return new Response(JSON.stringify({ error: dueErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!due || due.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let queued = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of due) {
    try {
      // Load booking + tenant freshness
      const table = r.booking_type === "service"
        ? "service_bookings"
        : "test_drive_bookings";
      const dateCol = r.booking_type === "service"
        ? "booking_date"
        : "preferred_date";

      const { data: booking } = await supabase
        .from(table)
        .select(
          `id, status, customer_name, vehicle_model, phone_number, ${dateCol}`,
        )
        .eq("id", r.booking_id)
        .maybeSingle();

      if (!booking) {
        await supabase
          .from("booking_reminders")
          .update({
            status: "skipped",
            error_message: "booking_missing",
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        skipped++;
        continue;
      }

      const stopList = r.rule?.stop_on_statuses ?? ["cancelled", "completed"];
      if (stopList.includes(String(booking.status))) {
        await supabase
          .from("booking_reminders")
          .update({
            status: "skipped",
            error_message: `booking_status_${booking.status}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        skipped++;
        continue;
      }

      // Verify tenant active
      const { data: tenant } = await supabase
        .from("tenants")
        .select("status")
        .eq("id", r.tenant_id)
        .maybeSingle();
      if (!tenant || tenant.status !== "active") {
        await supabase
          .from("booking_reminders")
          .update({
            status: "skipped",
            error_message: "tenant_inactive",
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        skipped++;
        continue;
      }

      const phone = r.recipient_phone || booking.phone_number;
      if (!phone) {
        await supabase
          .from("booking_reminders")
          .update({
            status: "skipped",
            error_message: "missing_phone",
            updated_at: new Date().toISOString(),
          })
          .eq("id", r.id);
        skipped++;
        continue;
      }

      const vars = {
        customer_name: booking.customer_name ?? "",
        vehicle_model: booking.vehicle_model ?? "",
        booking_date: String(
          (booking as Record<string, unknown>)[dateCol] ?? "",
        ),
      };

      const rawBody = r.rule?.message_body ?? "";
      const renderedBody = rawBody ? renderTemplate(rawBody, vars) : null;

      const { data: queueRow, error: queueErr } = await supabase
        .from("whatsapp_message_queue")
        .insert({
          tenant_id: r.tenant_id,
          recipient_phone: phone,
          message_type: r.rule?.template_name ? "template" : "text",
          template_name: r.rule?.template_name ?? null,
          template_params: r.rule?.template_name
            ? [
              {
                type: "body",
                parameters: Object.entries(vars).map(([, v]) => ({
                  type: "text",
                  text: v,
                })),
              },
            ]
            : null,
          content: renderedBody,
          status: "queued",
        })
        .select("id")
        .single();

      if (queueErr) throw queueErr;

      await supabase
        .from("booking_reminders")
        .update({
          status: "sent",
          queue_message_id: queueRow.id,
          rendered_body: renderedBody,
          attempts: r.attempts + 1,
          last_attempt_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id);

      queued++;
    } catch (err) {
      console.error("[dispatch-reminders] failure", r.id, err);
      await supabase
        .from("booking_reminders")
        .update({
          status: "failed",
          error_message: String(err),
          attempts: r.attempts + 1,
          last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      failed++;
    }
  }

  return new Response(
    JSON.stringify({
      processed: due.length,
      queued,
      skipped,
      failed,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

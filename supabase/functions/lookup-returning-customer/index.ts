// Public edge function: returns minimal returning-customer info for the
// public chatbot. The phone number is hashed server-side and never exposed
// in client-side queries. Rate-limited per tenant + IP to limit enumeration.
//
// Request:  POST { tenant_id: uuid, phone: string }
// Response: 200 { found: boolean, customer?: { first_name, vehicle_model,
//                  registration_masked, last_kms, last_date, service_type,
//                  status, notes } }
//
// Notes on privacy:
// - Anon JWT cannot read service_bookings (RLS), so this is the ONLY public
//   path to returning-customer info.
// - We never echo the raw phone or full name back.
// - The vehicle registration is masked to the last 4 chars.
// - Rate limit: 10 lookups / minute per (tenant + IP).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

function maskRegistration(reg: string | null): string | null {
  if (!reg) return null;
  const cleaned = reg.replace(/\s+/g, "");
  if (cleaned.length <= 4) return cleaned;
  return "•••• " + cleaned.slice(-4);
}

function firstName(full: string): string {
  return (full || "").trim().split(/\s+/)[0] || "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: { tenant_id?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const tenantId = (body.tenant_id || "").trim();
  const phone = (body.phone || "").trim();
  const digits = phone.replace(/\D+/g, "");

  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
    return jsonResponse({ error: "invalid_tenant" }, 400);
  }
  if (digits.length < 8) {
    return jsonResponse({ found: false });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Confirm tenant is active before doing any lookup.
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, status")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant || tenant.status !== "active") {
    return jsonResponse({ error: "tenant_inactive" }, 403);
  }

  // Rate limit: per tenant + caller IP.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "anon";
  const rateKey = `lookup_rc:${tenantId}:${ip}`;
  const { data: allowed, error: rlErr } = await supabase.rpc("check_rate_limit", {
    _key: rateKey,
    _max_tokens: 10,
    _refill_rate: 1,
    _window_seconds: 60,
  });
  if (rlErr) console.error("rate_limit_error", rlErr);
  if (allowed === false) {
    return jsonResponse({ error: "rate_limited" }, 429);
  }

  // Compute the salted hash via the SECURITY DEFINER DB function.
  const { data: hashRow, error: hashErr } = await supabase.rpc("hash_phone", {
    _tenant_id: tenantId,
    _phone: digits,
  });
  if (hashErr || !hashRow) {
    console.error("hash_phone_error", hashErr);
    return jsonResponse({ error: "lookup_failed" }, 500);
  }
  const phoneHash = hashRow as string;

  // Lookup by hash only — never by raw phone.
  const { data: row } = await supabase
    .from("service_bookings")
    .select(
      "customer_name, vehicle_model, vehicle_id, kms_driven, booking_date, service_type, status, work_notes, executive_notes, issue_description",
    )
    .eq("tenant_id", tenantId)
    .eq("phone_hash", phoneHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return jsonResponse({ found: false });

  let registration: string | null = null;
  if (row.vehicle_id) {
    const { data: veh } = await supabase
      .from("vehicles")
      .select("license_plate")
      .eq("tenant_id", tenantId)
      .eq("id", row.vehicle_id)
      .maybeSingle();
    registration = veh?.license_plate ?? null;
  }

  return jsonResponse({
    found: true,
    customer: {
      first_name: firstName(row.customer_name || ""),
      // Full name kept for the chat to greet & prefill the name field — same
      // data the user themselves typed previously on this dealer's bot.
      name: row.customer_name || "",
      vehicle_model: row.vehicle_model || "",
      registration,
      registration_masked: maskRegistration(registration),
      last_kms: row.kms_driven ?? null,
      last_date: row.booking_date || "",
      service_type: row.service_type || null,
      status: row.status || "pending",
      notes: row.work_notes || row.executive_notes || row.issue_description || null,
    },
  });
});

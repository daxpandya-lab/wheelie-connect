// Updates ONLY the profile/branding/marketing keys inside tenants.settings
// for the caller's active tenant. Never touches other tenants or unrelated keys.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  workshop_name?: string | null;
  support_phone?: string | null;
  business_address?: string | null;
  chatbot_welcome_script?: string | null;
  google_review_url?: string | null;
  logo_url?: string | null;
  primary_color?: string | null;
  // Super-admin only override — edit another tenant's settings.
  tenant_id?: string | null;
};

const ALLOWED_KEYS = [
  "workshop_name",
  "support_phone",
  "business_address",
  "chatbot_welcome_script",
  "google_review_url",
  "logo_url",
  "primary_color",
] as const;

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t.slice(0, 2000) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Resolve caller's tenant + verify tenant_admin role
    const { data: profile } = await admin
      .from("profiles").select("tenant_id").eq("user_id", userData.user.id).maybeSingle();
    const callerTenantId = profile?.tenant_id;
    if (!callerTenantId) {
      return new Response(JSON.stringify({ error: "No active tenant" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Is the caller a super_admin? (super_admin rows are not always tenant-scoped)
    const { data: superRow } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("role", "super_admin").maybeSingle();
    const isSuperAdmin = !!superRow;

    let body: Body;
    try { body = await req.json(); } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Super-admin may target any tenant via body.tenant_id; everyone else is
    // locked to their own tenant regardless of what they send.
    const requestedTenantId = typeof body.tenant_id === "string" && body.tenant_id.length ? body.tenant_id : null;
    const tenantId = isSuperAdmin && requestedTenantId ? requestedTenantId : callerTenantId;

    if (!isSuperAdmin) {
      const { data: roleRow } = await admin
        .from("user_roles").select("role")
        .eq("user_id", userData.user.id).eq("tenant_id", tenantId)
        .in("role", ["tenant_admin"]).maybeSingle();
      if (!roleRow) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Only pick allowed keys
    const patch: Record<string, string | null> = {};
    for (const k of ALLOWED_KEYS) {
      if (k in body) patch[k] = clean((body as Record<string, unknown>)[k]);
    }
    if (Object.keys(patch).length === 0) {
      return new Response(JSON.stringify({ error: "No valid fields provided" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Validate URLs / hex if provided
    if (patch.google_review_url && !/^https?:\/\/.+/i.test(patch.google_review_url)) {
      return new Response(JSON.stringify({ error: "google_review_url must be a valid URL" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (patch.logo_url && !/^https?:\/\/.+/i.test(patch.logo_url)) {
      return new Response(JSON.stringify({ error: "logo_url must be a valid URL" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (patch.primary_color && !/^#?[0-9a-fA-F]{6}$/.test(patch.primary_color)) {
      return new Response(JSON.stringify({ error: "primary_color must be a 6-digit hex" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (patch.primary_color && !patch.primary_color.startsWith("#")) {
      patch.primary_color = `#${patch.primary_color}`;
    }

    // Merge patch into existing settings — preserve all other keys.
    const { data: tenant, error: readErr } = await admin
      .from("tenants").select("settings").eq("id", tenantId).single();
    if (readErr || !tenant) {
      return new Response(JSON.stringify({ error: "Tenant not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const current = (tenant.settings as Record<string, unknown>) || {};
    const next = { ...current, ...patch };

    const { error: updErr } = await admin
      .from("tenants").update({ settings: next }).eq("id", tenantId);
    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, settings: next }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

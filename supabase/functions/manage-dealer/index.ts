import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await supabaseAdmin.auth.getUser(token);
    if (!caller) return json({ error: "Invalid token" }, 401);

    const { data: roleData } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", caller.id).eq("role", "super_admin").single();
    if (!roleData) return json({ error: "Forbidden" }, 403);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "create") {
      const body = await req.json();
      const { name, contact_person, phone, email, address, password, plan, status, start_date, end_date } = body;

      if (!name || !email || !password) return json({ error: "Name, email and password are required" }, 400);
      if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return json({ error: "Invalid email format" }, 400);

      const tenantSlug = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

      const { service_booking_enabled, test_drive_enabled } = body;
      const { data: tenant, error: tenantError } = await supabaseAdmin.from("tenants").insert({
        name: name.trim(), slug: tenantSlug,
        contact_person: contact_person?.trim() || null, phone: phone?.trim() || null,
        email: email.trim().toLowerCase(), address: address?.trim() || null,
        plan: plan || "free", status: status || "active",
        subscription_start_date: start_date || null, subscription_end_date: end_date || null,
        service_booking_enabled: service_booking_enabled ?? true,
        test_drive_enabled: test_drive_enabled ?? true,
      }).select().single();
      if (tenantError) return json({ error: tenantError.message }, 400);

      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim().toLowerCase(), password, email_confirm: true,
        user_metadata: { full_name: contact_person || name },
      });
      if (authError) {
        await supabaseAdmin.from("tenants").delete().eq("id", tenant.id);
        return json({ error: authError.message }, 400);
      }

      await supabaseAdmin.from("profiles").update({
        tenant_id: tenant.id, full_name: contact_person || name,
        phone: phone || null, email: email.trim().toLowerCase(),
        initial_password: password,
      }).eq("user_id", authUser.user.id);

      await supabaseAdmin.from("user_roles").insert({
        user_id: authUser.user.id, tenant_id: tenant.id, role: "tenant_admin",
      });

      return json({ tenant, user_id: authUser.user.id });
    }

    if (action === "update") {
      const body = await req.json();
      const { id, ...updates } = body;
      if (!id) return json({ error: "Tenant ID required" }, 400);

      const updatePayload: Record<string, unknown> = {};
      if (updates.name !== undefined) updatePayload.name = updates.name.trim();
      if (updates.contact_person !== undefined) updatePayload.contact_person = updates.contact_person?.trim() || null;
      if (updates.phone !== undefined) updatePayload.phone = updates.phone?.trim() || null;
      if (updates.email !== undefined) updatePayload.email = updates.email?.trim()?.toLowerCase() || null;
      if (updates.address !== undefined) updatePayload.address = updates.address?.trim() || null;
      if (updates.plan !== undefined) updatePayload.plan = updates.plan;
      if (updates.status !== undefined) updatePayload.status = updates.status;
      if (updates.start_date !== undefined) updatePayload.subscription_start_date = updates.start_date || null;
      if (updates.end_date !== undefined) updatePayload.subscription_end_date = updates.end_date || null;

      const { data, error } = await supabaseAdmin.from("tenants").update(updatePayload).eq("id", id).select().single();
      if (error) return json({ error: error.message }, 400);
      return json({ tenant: data });
    }

    if (action === "reset-password") {
      const body = await req.json();
      const { tenant_id, new_password } = body;
      if (!tenant_id || !new_password) return json({ error: "tenant_id and new_password required" }, 400);
      if (new_password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);

      const { data: roleData } = await supabaseAdmin
        .from("user_roles").select("user_id").eq("tenant_id", tenant_id).eq("role", "tenant_admin").limit(1).maybeSingle();

      let userId = roleData?.user_id;
      if (!userId) {
        const { data: profile } = await supabaseAdmin
          .from("profiles").select("user_id").eq("tenant_id", tenant_id).limit(1).maybeSingle();
        userId = profile?.user_id;
      }
      if (!userId) return json({ error: "No admin user found for this dealer" }, 404);

      const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, { password: new_password });
      if (error) return json({ error: error.message }, 400);

      await supabaseAdmin.from("profiles").update({ initial_password: new_password }).eq("user_id", userId);
      return json({ success: true });
    }

    if (action === "get-credentials") {
      const { data: tenants } = await supabaseAdmin.from("tenants").select("id");
      if (!tenants || tenants.length === 0) return json({ credentials: {} });

      const tenantIds = tenants.map(t => t.id);
      const { data: adminRoles } = await supabaseAdmin
        .from("user_roles").select("user_id, tenant_id").in("tenant_id", tenantIds).eq("role", "tenant_admin");

      if (!adminRoles || adminRoles.length === 0) return json({ credentials: {} });

      const userIds = adminRoles.map(r => r.user_id);
      const { data: profiles } = await supabaseAdmin
        .from("profiles").select("user_id, email, initial_password").in("user_id", userIds);

      const credentials: Record<string, { email: string | null; password: string | null }> = {};
      for (const role of adminRoles) {
        const p = profiles?.find(pr => pr.user_id === role.user_id);
        credentials[role.tenant_id] = { email: p?.email ?? null, password: p?.initial_password ?? null };
      }
      return json({ credentials });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
});

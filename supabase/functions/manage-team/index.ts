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

    // Verify caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await supabaseAdmin.auth.getUser(token);
    if (!caller) return json({ error: "Invalid token" }, 401);

    // Check caller is tenant_admin or super_admin
    const { data: callerRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role, tenant_id")
      .eq("user_id", caller.id);

    const isSuperAdmin = callerRoles?.some(r => r.role === "super_admin");
    const tenantAdminRole = callerRoles?.find(r => r.role === "tenant_admin");

    if (!isSuperAdmin && !tenantAdminRole) return json({ error: "Forbidden" }, 403);

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // Get caller's tenant_id
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("tenant_id")
      .eq("user_id", caller.id)
      .single();

    const callerTenantId = callerProfile?.tenant_id;

    if (action === "create") {
      const body = await req.json();
      const { name, phone, email, password, role, tenant_id } = body;

      const targetTenantId = isSuperAdmin && tenant_id ? tenant_id : callerTenantId;
      if (!targetTenantId) return json({ error: "No tenant context" }, 400);
      if (!name || !email || !password) return json({ error: "Name, email and password are required" }, 400);
      if (password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return json({ error: "Invalid email format" }, 400);

      // Create auth user
      const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password,
        email_confirm: true,
        user_metadata: { full_name: name.trim() },
      });
      if (authError) return json({ error: authError.message }, 400);

      // Update profile with tenant_id and phone
      await supabaseAdmin.from("profiles").update({
        tenant_id: targetTenantId,
        full_name: name.trim(),
        phone: phone?.trim() || null,
      }).eq("user_id", authUser.user.id);

      // Assign role
      const appRole = role === "tenant_admin" ? "tenant_admin" : "staff";
      await supabaseAdmin.from("user_roles").insert({
        user_id: authUser.user.id,
        tenant_id: targetTenantId,
        role: appRole,
      });

      return json({ success: true, user_id: authUser.user.id });
    }

    if (action === "update") {
      const body = await req.json();
      const { user_id, name, phone, role } = body;
      if (!user_id) return json({ error: "user_id required" }, 400);

      // Verify target user belongs to same tenant
      const { data: targetProfile } = await supabaseAdmin
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", user_id)
        .single();

      if (!isSuperAdmin && targetProfile?.tenant_id !== callerTenantId) {
        return json({ error: "Cannot modify user from another tenant" }, 403);
      }

      // Update profile
      const profileUpdate: Record<string, unknown> = {};
      if (name !== undefined) profileUpdate.full_name = name.trim();
      if (phone !== undefined) profileUpdate.phone = phone?.trim() || null;
      if (Object.keys(profileUpdate).length > 0) {
        await supabaseAdmin.from("profiles").update(profileUpdate).eq("user_id", user_id);
      }

      // Update role if changed
      if (role) {
        const appRole = role === "tenant_admin" ? "tenant_admin" : "staff";
        await supabaseAdmin.from("user_roles")
          .update({ role: appRole })
          .eq("user_id", user_id)
          .eq("tenant_id", targetProfile?.tenant_id);
      }

      return json({ success: true });
    }

    if (action === "delete") {
      const body = await req.json();
      const { user_id } = body;
      if (!user_id) return json({ error: "user_id required" }, 400);

      // Verify target user belongs to same tenant
      const { data: targetProfile } = await supabaseAdmin
        .from("profiles")
        .select("tenant_id")
        .eq("user_id", user_id)
        .single();

      if (!isSuperAdmin && targetProfile?.tenant_id !== callerTenantId) {
        return json({ error: "Cannot delete user from another tenant" }, 403);
      }

      // Don't allow deleting yourself
      if (user_id === caller.id) return json({ error: "Cannot delete yourself" }, 400);

      // Delete auth user (cascades to profiles and user_roles)
      const { error } = await supabaseAdmin.auth.admin.deleteUser(user_id);
      if (error) return json({ error: error.message }, 400);

      return json({ success: true });
    }

    if (action === "reset-password") {
      const body = await req.json();
      const { user_id, new_password } = body;
      if (!user_id || !new_password) return json({ error: "user_id and new_password required" }, 400);
      if (new_password.length < 6) return json({ error: "Password must be at least 6 characters" }, 400);

      const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, { password: new_password });
      if (error) return json({ error: error.message }, 400);

      return json({ success: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
});

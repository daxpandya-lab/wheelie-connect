import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify caller is super_admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user: caller },
    } = await supabaseAdmin.auth.getUser(token);
    if (!caller) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check super_admin role
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "super_admin")
      .single();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (action === "create") {
      const body = await req.json();
      const {
        name,
        slug,
        contact_person,
        phone,
        email,
        address,
        plan,
        status,
        start_date,
        end_date,
        password,
      } = body;

      if (!name || !email || !password) {
        return new Response(
          JSON.stringify({ error: "Name, email and password are required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return new Response(
          JSON.stringify({ error: "Invalid email format" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Validate password length
      if (password.length < 6) {
        return new Response(
          JSON.stringify({
            error: "Password must be at least 6 characters",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // 1. Create tenant
      const tenantSlug = (slug || name)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

      const { data: tenant, error: tenantError } = await supabaseAdmin
        .from("tenants")
        .insert({
          name: name.trim(),
          slug: tenantSlug,
          contact_person: contact_person?.trim() || null,
          phone: phone?.trim() || null,
          email: email.trim().toLowerCase(),
          address: address?.trim() || null,
          plan: plan || "free",
          status: status || "active",
          subscription_start_date: start_date || null,
          subscription_end_date: end_date || null,
        })
        .select()
        .single();

      if (tenantError) {
        return new Response(JSON.stringify({ error: tenantError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 2. Create auth user
      const { data: authUser, error: authError } =
        await supabaseAdmin.auth.admin.createUser({
          email: email.trim().toLowerCase(),
          password,
          email_confirm: true,
          user_metadata: { full_name: contact_person || name },
        });

      if (authError) {
        // Rollback tenant
        await supabaseAdmin.from("tenants").delete().eq("id", tenant.id);
        return new Response(JSON.stringify({ error: authError.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 3. Update profile with tenant_id
      await supabaseAdmin
        .from("profiles")
        .update({ tenant_id: tenant.id, full_name: contact_person || name })
        .eq("user_id", authUser.user.id);

      // 4. Assign tenant_admin role
      await supabaseAdmin.from("user_roles").insert({
        user_id: authUser.user.id,
        tenant_id: tenant.id,
        role: "tenant_admin",
      });

      return new Response(
        JSON.stringify({ tenant, user_id: authUser.user.id }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "update") {
      const body = await req.json();
      const { id, ...updates } = body;

      if (!id) {
        return new Response(
          JSON.stringify({ error: "Tenant ID required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const updatePayload: Record<string, unknown> = {};
      if (updates.name !== undefined) updatePayload.name = updates.name.trim();
      if (updates.contact_person !== undefined)
        updatePayload.contact_person = updates.contact_person?.trim() || null;
      if (updates.phone !== undefined)
        updatePayload.phone = updates.phone?.trim() || null;
      if (updates.email !== undefined)
        updatePayload.email = updates.email?.trim()?.toLowerCase() || null;
      if (updates.address !== undefined)
        updatePayload.address = updates.address?.trim() || null;
      if (updates.plan !== undefined) updatePayload.plan = updates.plan;
      if (updates.status !== undefined) updatePayload.status = updates.status;
      if (updates.start_date !== undefined)
        updatePayload.subscription_start_date = updates.start_date || null;
      if (updates.end_date !== undefined)
        updatePayload.subscription_end_date = updates.end_date || null;

      const { data, error } = await supabaseAdmin
        .from("tenants")
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ tenant: data }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "reset-password") {
      const body = await req.json();
      const { tenant_id, new_password } = body;

      if (!tenant_id || !new_password) {
        return new Response(
          JSON.stringify({ error: "tenant_id and new_password required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (new_password.length < 6) {
        return new Response(
          JSON.stringify({
            error: "Password must be at least 6 characters",
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Find tenant admin user - check user_roles first, then profiles
      let userId: string | null = null;

      const { data: roleData } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("tenant_id", tenant_id)
        .eq("role", "tenant_admin")
        .limit(1)
        .maybeSingle();

      if (roleData) {
        userId = roleData.user_id;
      } else {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("user_id")
          .eq("tenant_id", tenant_id)
          .limit(1)
          .maybeSingle();
        if (profile) userId = profile.user_id;
      }

      if (!userId) {
        return new Response(
          JSON.stringify({ error: "No admin user found for this dealer. The dealer may have been created without login credentials. Please edit the dealer and ensure an email is set, then re-create credentials." }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const { error } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { password: new_password }
      );

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

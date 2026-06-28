import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

// Sweeper: marks API keys as fully revoked once their grace window has elapsed.
// A key is considered "in grace" when revoked_at is set but still in the future.
// Once revoked_at <= now(), this job stamps fully_revoked_at so downstream
// auditing/dashboards can distinguish "scheduled" vs "fully disabled".

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("tenant_api_keys")
    .update({ fully_revoked_at: nowIso })
    .lte("revoked_at", nowIso)
    .is("fully_revoked_at", null)
    .select("id, tenant_id, token_prefix, revoked_at");

  if (error) {
    console.error("[sweep-expired-api-keys] update failed", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const swept = data?.length ?? 0;
  if (swept > 0) {
    console.log(`[sweep-expired-api-keys] sealed ${swept} expired key(s)`, data);
  }

  return new Response(
    JSON.stringify({ swept, at: nowIso, keys: data ?? [] }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

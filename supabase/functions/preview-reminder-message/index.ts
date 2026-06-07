import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mirror of dispatch-booking-reminders renderTemplate. Keep in sync.
function renderTemplate(
  body: string,
  vars: Record<string, string | null | undefined>,
): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v == null ? "" : String(v);
  });
}

interface PreviewBody {
  rule_id?: string;
  // Optional unsaved overrides so admins can preview before saving.
  message_body?: string | null;
  template_name?: string | null;
  variables?: Record<string, string>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: PreviewBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const variables: Record<string, string> = {
    customer_name: String(body.variables?.customer_name ?? ""),
    vehicle_model: String(body.variables?.vehicle_model ?? ""),
    booking_date: String(body.variables?.booking_date ?? ""),
  };

  let messageBody = body.message_body ?? null;
  let templateName = body.template_name ?? null;

  // If rule_id provided and no inline body, load the saved rule (RLS scopes to tenant).
  if (body.rule_id && messageBody == null && templateName == null) {
    const { data: rule, error: ruleErr } = await supabase
      .from("booking_reminder_rules")
      .select("message_body, template_name")
      .eq("id", body.rule_id)
      .maybeSingle();
    if (ruleErr) {
      return new Response(JSON.stringify({ error: ruleErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!rule) {
      return new Response(JSON.stringify({ error: "Rule not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    messageBody = rule.message_body;
    templateName = rule.template_name;
  }

  const trimmedBody = messageBody?.trim() || null;
  const trimmedTemplate = templateName?.trim() || null;

  if (!trimmedBody && trimmedTemplate) {
    return new Response(
      JSON.stringify({
        mode: "template",
        template_name: trimmedTemplate,
        rendered_body: null,
        note: "Uses a pre-approved WhatsApp template; exact text is fixed by the template.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!trimmedBody) {
    return new Response(
      JSON.stringify({ error: "No message body or template configured" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const rendered = renderTemplate(trimmedBody, variables);
  return new Response(
    JSON.stringify({
      mode: "text",
      rendered_body: rendered,
      variables_used: variables,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

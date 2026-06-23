// AI Insights — aggregates read-only tenant metrics and asks Lovable AI Gateway
// to summarize them into three executive-facing buckets.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await admin.from("profiles").select("tenant_id").eq("user_id", user.id).single();
    const tenantId = profile?.tenant_id;
    if (!tenantId) {
      return new Response(JSON.stringify({ error: "No tenant" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Aggregate read-only metrics
    const [bookingsRes, leadsRes, sessionsRes] = await Promise.all([
      admin.from("service_bookings")
        .select("status, vehicle_make, vehicle_model, service_type, customer_feedback, csat_rating, booking_date")
        .eq("tenant_id", tenantId).limit(1000),
      admin.from("leads").select("status, source").eq("tenant_id", tenantId).limit(1000),
      admin.from("chatbot_conversations").select("is_complete, dropped_off").eq("tenant_id", tenantId).limit(1000),
    ]);

    const bookings = bookingsRes.data ?? [];
    const leads = leadsRes.data ?? [];
    const sessions = sessionsRes.data ?? [];

    const countBy = (arr: any[], key: string) => arr.reduce<Record<string, number>>((m, r) => {
      const k = (r?.[key] ?? "unknown") || "unknown";
      m[String(k)] = (m[String(k)] ?? 0) + 1;
      return m;
    }, {});

    const summary = {
      total_bookings: bookings.length,
      bookings_by_status: countBy(bookings, "status"),
      bookings_by_make: countBy(bookings, "vehicle_make"),
      bookings_by_service_type: countBy(bookings, "service_type"),
      total_leads: leads.length,
      leads_by_status: countBy(leads, "status"),
      chatbot_sessions: sessions.length,
      chatbot_completed: sessions.filter((s: any) => s?.is_complete).length,
      chatbot_dropped: sessions.filter((s: any) => s?.dropped_off).length,
      feedback_samples: bookings
        .map((b: any) => b?.customer_feedback)
        .filter((t: any) => typeof t === "string" && t.length > 0)
        .slice(0, 25),
      csat_ratings: bookings.map((b: any) => b?.csat_rating).filter((n: any) => typeof n === "number"),
    };

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an automotive workshop operations analyst. Given the JSON metrics below for a single dealership, produce concise executive insights.

Return STRICT JSON with this shape (no markdown, no commentary):
{
  "workload_bottlenecks": [ "short bullet", ... ],
  "revenue_leakage": [ "short bullet", ... ],
  "vehicle_insights": [ "short bullet", ... ]
}

Each array: 3-5 bullets, max ~140 chars each, plain English, specific to the data.

DATA:
${JSON.stringify(summary)}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return new Response(JSON.stringify({ error: "AI gateway failed", detail: txt }), {
        status: aiRes.status === 429 || aiRes.status === 402 ? aiRes.status : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const content = aiJson?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }

    return new Response(JSON.stringify({
      summary,
      insights: {
        workload_bottlenecks: parsed.workload_bottlenecks ?? [],
        revenue_leakage: parsed.revenue_leakage ?? [],
        vehicle_insights: parsed.vehicle_insights ?? [],
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

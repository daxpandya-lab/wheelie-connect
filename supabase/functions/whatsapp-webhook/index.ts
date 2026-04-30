import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// ============================================================
// LANGUAGE DETECTION — script-based with keyword fallback
// Returns one of the supported flow languages: "en" | "hi" | "ar"
// ============================================================
type Lang = "en" | "hi" | "ar";
const SUPPORTED_LANGS: Lang[] = ["en", "hi", "ar"];

function detectLanguage(text: string): Lang | null {
  if (!text) return null;
  // Arabic script (covers Arabic, Persian, Urdu shared range)
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(text)) return "ar";
  // Devanagari (Hindi)
  if (/[\u0900-\u097F]/.test(text)) return "hi";
  // Romanized Hindi keyword sniff (very common on WhatsApp)
  const lower = text.toLowerCase();
  const hiRoman = /\b(namaste|namaskar|kaise|kaisa|kaisi|kya|hai|haan|nahi|nahin|theek|thik|sahi|kar|karo|chahiye|seva|gaadi|service|book karna|krna|krdo|kardo|bhai|bhaiya|aap|tumhara|hamara|hindi|mein|me|mai)\b/;
  if (hiRoman.test(lower)) return "hi";
  return "en";
}

// Pick the localized string from a {en,hi,ar} bundle, falling back gracefully.
function pickLang(bundle: any, lang: Lang): string {
  if (!bundle) return "";
  if (typeof bundle === "string") return bundle;
  return bundle[lang] || bundle.en || bundle.hi || bundle.ar || "";
}

// ============================================================
// FLOW CACHE — in-memory, invalidated when chatbot_flows.updated_at changes
// ============================================================
type CachedFlow = { id: string; flow_data: any; updated_at: string; cachedAt: number };
const FLOW_CACHE = new Map<string, CachedFlow>(); // key: tenant_id
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getActiveFlowForTenant(supabase: any, tenantId: string): Promise<{ id: string; flow_data: any } | null> {
  const cached = FLOW_CACHE.get(tenantId);
  const now = Date.now();

  // Fast path: only check updated_at to invalidate (single tiny query)
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    const { data: head } = await supabase
      .from("chatbot_flows")
      .select("id, updated_at")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (head && head.id === cached.id && head.updated_at === cached.updated_at) {
      console.log(`[FLOW-CACHE] HIT tenant=${tenantId}`);
      return { id: cached.id, flow_data: cached.flow_data };
    }
    console.log(`[FLOW-CACHE] STALE tenant=${tenantId}`);
  }

  const { data: flow } = await supabase
    .from("chatbot_flows")
    .select("id, flow_data, updated_at")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!flow) return null;
  FLOW_CACHE.set(tenantId, { id: flow.id, flow_data: flow.flow_data, updated_at: flow.updated_at, cachedAt: now });
  console.log(`[FLOW-CACHE] LOAD tenant=${tenantId} flow=${flow.id}`);
  return { id: flow.id, flow_data: flow.flow_data };
}

async function getFlowById(supabase: any, tenantId: string, flowId: string) {
  // Look in cache first
  const cached = FLOW_CACHE.get(tenantId);
  if (cached && cached.id === flowId && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.flow_data;
  }
  const { data: flow } = await supabase
    .from("chatbot_flows")
    .select("id, flow_data, updated_at")
    .eq("id", flowId)
    .maybeSingle();
  if (flow) FLOW_CACHE.set(tenantId, { id: flow.id, flow_data: flow.flow_data, updated_at: flow.updated_at, cachedAt: Date.now() });
  return flow?.flow_data;
}

// ============================================================
// DATE HELPERS — DD-MM-YYYY everywhere
// ============================================================
function formatDDMMYYYY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function toISODate(input: string): string | null {
  // Accept DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD
  const s = input.trim();
  let m = s.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return s;
  return null;
}

function nextDays(n: number, startOffset = 0): { iso: string; ddmmyyyy: string; label: string }[] {
  const out: { iso: string; ddmmyyyy: string; label: string }[] = [];
  const today = new Date();
  for (let i = startOffset; i < startOffset + n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = d.toISOString().split("T")[0];
    const ddmmyyyy = formatDDMMYYYY(d);
    let label = ddmmyyyy;
    if (i === 0) label = `Today (${ddmmyyyy})`;
    else if (i === 1) label = `Tomorrow (${ddmmyyyy})`;
    out.push({ iso, ddmmyyyy, label });
  }
  return out;
}

// ============================================================
// COMMON
// ============================================================
async function checkRateLimit(supabase: any, key: string, maxTokens = 120, windowSeconds = 60): Promise<boolean> {
  const { data } = await supabase.rpc("check_rate_limit", {
    _key: key, _max_tokens: maxTokens, _refill_rate: 1, _window_seconds: windowSeconds,
  });
  return data === true;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  interactive?: { type: string; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
  referral?: {
    source_url?: string;
    source_id?: string;
    source_type?: string;
    headline?: string;
    body?: string;
    media_type?: string;
    image_url?: string;
    video_url?: string;
    thumbnail_url?: string;
    ctwa_clid?: string;
    source_ad_name?: string;
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ========== WEBHOOK VERIFICATION (GET) ==========
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token) {
      if (token === "lovable") return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
      const { data: session } = await supabase
        .from("whatsapp_sessions")
        .select("id, tenant_id")
        .eq("verify_token", token)
        .eq("is_active", true)
        .single();
      if (session) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
      return new Response("Verification token mismatch", { status: 403 });
    }
    return new Response("OK", { status: 200 });
  }

  // ========== INCOMING MESSAGES (POST) ==========
  if (req.method === "POST") {
    try {
      const body = await req.json();

      // -------- Evolution API webhook (message.upsert / messages.upsert) --------
      // Evolution payload shape (varies slightly by version):
      // { event: "messages.upsert", instance: "<instance_name>",
      //   data: { key: { remoteJid: "5511...@s.whatsapp.net", id, fromMe },
      //           message: { conversation, extendedTextMessage:{text}, buttonsResponseMessage:{...}, listResponseMessage:{...} },
      //           pushName: "Customer Name" } }
      const evtName = (body.event || body.eventName || "").toString().toLowerCase().replace(/_/g, ".");
      const isEvolution =
        !!body.instance &&
        (evtName.includes("messages.upsert") || evtName.includes("message.upsert") ||
         evtName.includes("messages.update") || !!body.data?.key);

      if (isEvolution) {
        const instanceName = String(body.instance || "").trim();
        const data = body.data || {};
        const key = data.key || {};
        if (key.fromMe) {
          return new Response(JSON.stringify({ success: true, skipped: "fromMe" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Extract phone from remoteJid (strip @s.whatsapp.net / @c.us, drop group msgs)
        const remoteJid: string = key.remoteJid || "";
        if (!remoteJid || remoteJid.includes("@g.us")) {
          return new Response(JSON.stringify({ success: true, skipped: "group_or_empty" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const customerPhone = remoteJid.split("@")[0].replace(/\D/g, "");
        if (!customerPhone) {
          return new Response(JSON.stringify({ success: true, skipped: "no_phone" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const customerName = data.pushName || customerPhone;

        // Extract message text + interactive id
        const m = data.message || {};
        let messageText = "";
        let interactiveId: string | null = null;
        if (typeof m.conversation === "string") messageText = m.conversation;
        else if (m.extendedTextMessage?.text) messageText = m.extendedTextMessage.text;
        else if (m.buttonsResponseMessage) {
          messageText = m.buttonsResponseMessage.selectedDisplayText || m.buttonsResponseMessage.selectedButtonId || "";
          interactiveId = m.buttonsResponseMessage.selectedButtonId || null;
        } else if (m.listResponseMessage) {
          messageText = m.listResponseMessage.title || m.listResponseMessage.singleSelectReply?.selectedRowId || "";
          interactiveId = m.listResponseMessage.singleSelectReply?.selectedRowId || null;
        } else if (m.templateButtonReplyMessage) {
          messageText = m.templateButtonReplyMessage.selectedDisplayText || "";
          interactiveId = m.templateButtonReplyMessage.selectedId || null;
        }

        if (!messageText && !interactiveId) {
          // Non-text payload (image/audio/etc.) — acknowledge and ignore for now
          return new Response(JSON.stringify({ success: true, skipped: "non_text" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Resolve tenant by Evolution instance_name in whatsapp_config
        const { data: tenantRow } = await supabase
          .from("tenants")
          .select("id, status, whatsapp_config")
          .eq("status", "active")
          .filter("whatsapp_config->evolution->>instance_name", "eq", instanceName)
          .maybeSingle();

        if (!tenantRow) {
          console.error(`[EVO] No tenant for instance="${instanceName}"`);
          return new Response(JSON.stringify({ success: true, skipped: "no_tenant" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        const tenantId = tenantRow.id;

        const allowed = await checkRateLimit(supabase, `webhook:evo:${tenantId}`, 120, 60);
        if (!allowed) {
          return new Response(JSON.stringify({ success: true, rate_limited: true }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Stamp last_webhook_at on whatsapp_sessions if one exists (for status indicator)
        await supabase.from("whatsapp_sessions")
          .update({ last_webhook_at: new Date().toISOString() })
          .eq("tenant_id", tenantId);

        // Find / create customer
        let customerId: string | null = null;
        const { data: existingCustomer } = await supabase
          .from("customers").select("id")
          .eq("tenant_id", tenantId).eq("phone", customerPhone).maybeSingle();
        if (existingCustomer) customerId = existingCustomer.id;
        else {
          const { data: newCustomer } = await supabase.from("customers")
            .insert({ tenant_id: tenantId, name: customerName, phone: customerPhone })
            .select("id").single();
          customerId = newCustomer?.id || null;
        }

        // Find / create conversation
        const { data: existingConvo } = await supabase
          .from("chatbot_conversations").select("id, metadata")
          .eq("tenant_id", tenantId).eq("phone_number", customerPhone)
          .eq("status", "active").order("started_at", { ascending: false })
          .limit(1).maybeSingle();

        let conversationId: string;
        let conversationMetadata: Record<string, unknown> = {};
        if (existingConvo) {
          conversationId = existingConvo.id;
          conversationMetadata = (existingConvo.metadata as Record<string, unknown>) || {};
        } else {
          const initialMeta: Record<string, unknown> = {
            current_flow_id: null,
            current_node_id: null,
            collected_data: {},
            gateway: "evolution",
          };
          const { data: newConvo } = await supabase.from("chatbot_conversations")
            .insert({
              tenant_id: tenantId, customer_id: customerId, channel: "whatsapp",
              phone_number: customerPhone, status: "active",
              metadata: initialMeta,
            })
            .select("id, metadata").single();
          conversationId = newConvo!.id;
          conversationMetadata = (newConvo!.metadata as Record<string, unknown>) || {};
        }

        // Persist inbound message
        const { data: savedMessage } = await supabase.from("chatbot_messages")
          .insert({
            tenant_id: tenantId, conversation_id: conversationId, sender_type: "customer",
            content: messageText,
            message_type: "text",
            metadata: { gateway: "evolution", evo_message_id: key.id, interactive_id: interactiveId },
          })
          .select("id").single();

        await processChatbotFlow(
          supabase, tenantId, conversationId, savedMessage!.id,
          messageText, interactiveId, customerPhone, conversationMetadata, customerId,
        );

        return new Response(JSON.stringify({ success: true, gateway: "evolution" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // -------- Official Meta Cloud API webhook --------
      const entries = body.object === "whatsapp_business_account" ? body.entry : [];

      for (const entry of entries) {
        for (const change of entry.changes) {
          if (change.field !== "messages") continue;
          const value = change.value;
          const phoneNumberId = value.metadata.phone_number_id;

          const allowed = await checkRateLimit(supabase, `webhook:${phoneNumberId}`, 120, 60);
          if (!allowed) { console.warn(`Rate limited: ${phoneNumberId}`); continue; }

          const { data: session } = await supabase
            .from("whatsapp_sessions")
            .select("id, tenant_id")
            .eq("phone_number_id", phoneNumberId)
            .eq("is_active", true)
            .single();

          if (!session) { console.error(`No tenant for phone_number_id: ${phoneNumberId}`); continue; }
          const tenantId = session.tenant_id;

          await supabase.from("whatsapp_sessions")
            .update({ last_webhook_at: new Date().toISOString() })
            .eq("id", session.id);

          if (value.statuses) {
            for (const status of value.statuses) {
              await supabase.from("whatsapp_message_queue")
                .update({ status: status.status as any })
                .eq("external_message_id", status.id)
                .eq("tenant_id", tenantId);
            }
          }

          if (value.messages && value.contacts) {
            for (const msg of value.messages as WhatsAppMessage[]) {
              const contact = value.contacts.find((c: any) => c.wa_id === msg.from);
              const customerPhone = msg.from;
              const customerName = contact?.profile?.name || customerPhone;

              let messageText = "";
              let interactiveId: string | null = null;
              if (msg.type === "text" && msg.text) messageText = msg.text.body;
              else if (msg.type === "interactive" && msg.interactive) {
                messageText = msg.interactive.button_reply?.title || msg.interactive.list_reply?.title || "";
                interactiveId = msg.interactive.button_reply?.id || msg.interactive.list_reply?.id || null;
              }

              // ===== Click-to-WhatsApp Ad referral capture =====
              const adSource = msg.referral
                ? {
                    source_ad_name: msg.referral.source_ad_name || msg.referral.headline || null,
                    source_ad_headline: msg.referral.headline || null,
                    source_ad_body: msg.referral.body || null,
                    source_url: msg.referral.source_url || null,
                    source_type: msg.referral.source_type || null, // e.g. 'ad'
                    ctwa_clid: msg.referral.ctwa_clid || null,
                    captured_at: new Date().toISOString(),
                  }
                : null;

              // Find/create customer
              let customerId: string | null = null;
              const { data: existingCustomer } = await supabase
                .from("customers").select("id")
                .eq("tenant_id", tenantId).eq("phone", customerPhone).maybeSingle();
              if (existingCustomer) customerId = existingCustomer.id;
              else {
                const { data: newCustomer } = await supabase.from("customers")
                  .insert({ tenant_id: tenantId, name: customerName, phone: customerPhone })
                  .select("id").single();
                customerId = newCustomer?.id || null;
              }

              // Find/create conversation
              const { data: existingConvo } = await supabase
                .from("chatbot_conversations").select("id, metadata")
                .eq("tenant_id", tenantId).eq("phone_number", customerPhone)
                .eq("status", "active").order("started_at", { ascending: false })
                .limit(1).maybeSingle();

              let conversationId: string;
              let conversationMetadata: Record<string, unknown> = {};
              if (existingConvo) {
                conversationId = existingConvo.id;
                conversationMetadata = (existingConvo.metadata as Record<string, unknown>) || {};
                // Stamp ad source onto existing convo if newly arrived and not already set
                if (adSource && !conversationMetadata.ad_source) {
                  conversationMetadata = { ...conversationMetadata, ad_source: adSource };
                  await supabase.from("chatbot_conversations")
                    .update({ metadata: conversationMetadata })
                    .eq("id", conversationId);
                }
              } else {
                const initialMeta: Record<string, unknown> = {
                  current_flow_id: null,
                  current_node_id: null,
                  collected_data: {},
                };
                if (adSource) initialMeta.ad_source = adSource;
                const { data: newConvo } = await supabase.from("chatbot_conversations")
                  .insert({
                    tenant_id: tenantId, customer_id: customerId, channel: "whatsapp",
                    phone_number: customerPhone, status: "active",
                    metadata: initialMeta,
                  })
                  .select("id, metadata").single();
                conversationId = newConvo!.id;
                conversationMetadata = (newConvo!.metadata as Record<string, unknown>) || {};
              }

              const { data: savedMessage } = await supabase.from("chatbot_messages")
                .insert({
                  tenant_id: tenantId, conversation_id: conversationId, sender_type: "customer",
                  content: messageText,
                  message_type: msg.type === "interactive" ? "text" : msg.type,
                  metadata: { wa_message_id: msg.id, wa_timestamp: msg.timestamp, interactive_id: interactiveId, referral: msg.referral || null },
                })
                .select("id").single();

              await processChatbotFlow(
                supabase, tenantId, conversationId, savedMessage!.id,
                messageText, interactiveId, customerPhone, conversationMetadata, customerId
              );
            }
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Webhook error:", error);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
});

// ============================================================
// FLOW PROCESSOR
// ============================================================
async function processChatbotFlow(
  supabase: any,
  tenantId: string,
  conversationId: string,
  messageId: string,
  userMessage: string,
  interactiveId: string | null,
  customerPhone: string,
  metadata: Record<string, unknown>,
  customerId: string | null,
) {
  const t0 = Date.now();
  const currentFlowId = metadata.current_flow_id as string | null;
  const currentNodeId = metadata.current_node_id as string | null;
  const collectedData = (metadata.collected_data as Record<string, unknown>) || {};

  // --- Auto language detection ---
  // Lock in the language on the first inbound text and reuse for the whole conversation.
  // Interactive button/list replies are language-agnostic, so skip detection for those.
  let lang: Lang = (collectedData.preferred_language as Lang) || "en";
  if (!collectedData.preferred_language && userMessage && !interactiveId) {
    const detected = detectLanguage(userMessage);
    if (detected && SUPPORTED_LANGS.includes(detected)) {
      lang = detected;
      collectedData.preferred_language = detected;
      console.log(`[FLOW] auto-detected language=${detected} for ${customerPhone}`);
    }
  }

  let flowId = currentFlowId;
  let flowData: any = null;

  if (!flowId) {
    const active = await getActiveFlowForTenant(supabase, tenantId);
    if (!active) {
      await queueReply(supabase, tenantId, conversationId, customerPhone,
        { type: "text", body: "Thank you for your message. Our team will get back to you shortly." });
      return;
    }
    flowId = active.id;
    flowData = active.flow_data;
  } else {
    flowData = await getFlowById(supabase, tenantId, flowId);
    if (!flowData) {
      const active = await getActiveFlowForTenant(supabase, tenantId);
      if (active) { flowId = active.id; flowData = active.flow_data; }
    }
  }

  if (!flowData?.nodes) return;
  const nodes = flowData.nodes;
  let nodeId = currentNodeId || flowData.startNodeId;
  let node = nodes.find((n: any) => n.id === nodeId);
  if (!node) return;

  // Process answer if we were waiting on this node
  if (currentNodeId && node) {
    // === Date handling for date_buttons / date validation ===
    let nextNodeId: string | undefined;

    if (node.type === "date_buttons" || node.validationType === "date") {
      // Interactive button/list reply IDs: today | tomorrow | other | date_<iso>
      let isoDate: string | null = null;
      if (interactiveId === "today") isoDate = new Date().toISOString().split("T")[0];
      else if (interactiveId === "tomorrow") {
        const d = new Date(); d.setDate(d.getDate() + 1);
        isoDate = d.toISOString().split("T")[0];
      } else if (interactiveId === "other") {
        // Send list of next 7 days starting day-after-tomorrow
        const days = nextDays(7, 2);
        await queueReply(supabase, tenantId, conversationId, customerPhone, {
          type: "list",
          body: "Choose a date 👇",
          buttonText: "Pick date",
          rows: days.map((d) => ({ id: `date_${d.iso}`, title: d.ddmmyyyy })),
        });
        // Stay on the same node, waiting for list reply
        await updateConversationMetadata(supabase, conversationId, flowId, nodeId, collectedData);
        console.log(`[FLOW] sent date list (${Date.now() - t0}ms)`);
        return;
      } else if (interactiveId?.startsWith("date_")) {
        isoDate = interactiveId.replace("date_", "");
      } else {
        isoDate = toISODate(userMessage);
      }

      if (!isoDate) {
        // Re-prompt with buttons
        await sendDateButtons(supabase, tenantId, conversationId, customerPhone, pickLang(node.message, lang) || "Please pick a date:");
        await updateConversationMetadata(supabase, conversationId, flowId, nodeId, collectedData);
        return;
      }

      if (node.dataField) {
        // Store as DD-MM-YYYY for display, ISO for booking_date
        const [y, m, d] = isoDate.split("-");
        collectedData[node.dataField] = `${d}-${m}-${y}`;
        collectedData[`${node.dataField}_iso`] = isoDate;
      }
      nextNodeId = node.nextNodeId;
    } else {
      // Generic answer storage
      if (node.dataField) {
        if (node.validationType === "number") collectedData[node.dataField] = parseInt(userMessage) || 0;
        else if (node.dataField === "pickup_required") {
          const lower = userMessage.toLowerCase();
          collectedData["pickup_required"] = lower.includes("yes") || lower.includes("both") || lower.includes("pickup");
          collectedData["drop_required"] = lower.includes("yes") || lower.includes("both") || lower.includes("drop");
        } else {
          collectedData[node.dataField] = userMessage;
        }
      }

      if (node.options) {
        const match = node.options.find((o: any) =>
          o.value.toLowerCase() === userMessage.toLowerCase() ||
          o.label.toLowerCase() === userMessage.toLowerCase() ||
          o.value === interactiveId
        );
        nextNodeId = match?.nextNodeId || node.options[0]?.nextNodeId || node.nextNodeId;
      } else {
        nextNodeId = node.nextNodeId;
      }
    }

    await supabase.from("chatbot_responses").insert({
      tenant_id: tenantId, conversation_id: conversationId, message_id: messageId,
      flow_id: flowId, intent_detected: node.dataField || node.type,
      confidence_score: 1.0, response_text: userMessage,
      response_time_ms: Date.now() - t0,
    });

    if (!nextNodeId) {
      await updateConversationMetadata(supabase, conversationId, null, null, collectedData);
      return;
    }
    node = nodes.find((n: any) => n.id === nextNodeId);
    nodeId = nextNodeId;
  }

  if (!node) return;

  // api_check
  if (node.type === "api_check" && node.metadata?.checkType === "slot_availability" && collectedData.preferred_date_iso) {
    const { count } = await supabase.from("service_bookings")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("booking_date", collectedData.preferred_date_iso);
    const maxSlots = (node.metadata.maxSlotsPerDay as number) || 10;
    const isAvailable = (count || 0) < maxSlots;
    const condNode = nodes.find((n: any) => n.id === node!.nextNodeId);
    if (condNode?.options) {
      const pick = condNode.options.find((o: any) => o.value === (isAvailable ? "available" : "full"));
      if (pick) { node = nodes.find((n: any) => n.id === pick.nextNodeId); nodeId = pick.nextNodeId; }
    }
  }

  // End node — create booking + lead with full metadata
  if (node?.type === "end" && node.metadata?.action) {
    const isoDate = (collectedData.preferred_date_iso as string) || new Date().toISOString().split("T")[0];

    // Build metadata blob: every collected data field except internal _iso helpers
    const cleanMetadata: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(collectedData)) {
      if (k.endsWith("_iso")) continue;
      cleanMetadata[k] = v;
    }
    cleanMetadata.flow_id = flowId;
    cleanMetadata.captured_at = new Date().toISOString();
    // Carry CTWA ad attribution from conversation metadata onto the lead/booking
    const adSource = (metadata as any)?.ad_source;
    if (adSource) {
      cleanMetadata.ad_source = adSource;
      cleanMetadata.source_ad_name = adSource.source_ad_name || adSource.source_ad_headline || null;
    }

    // Determine the originating gateway so reports can distinguish Meta vs Evolution
    const gateway = ((metadata as any)?.gateway as string) || "meta";
    const bookingSource = gateway === "evolution" ? "whatsapp_evolution" : "ai_bot";
    cleanMetadata.gateway = gateway;

    if (node.metadata.action === "create_service_booking") {
      await supabase.from("service_bookings").insert({
        tenant_id: tenantId, customer_id: customerId,
        customer_name: collectedData.customer_name || "",
        phone_number: customerPhone,
        vehicle_model: collectedData.vehicle_model || "",
        kms_driven: collectedData.kms_driven ? Number(collectedData.kms_driven) : null,
        service_type: collectedData.service_type || "General Service",
        booking_date: isoDate,
        pickup_required: !!collectedData.pickup_required,
        drop_required: !!collectedData.drop_required,
        notes: collectedData.issue_description || "",
        booking_source: bookingSource, status: "confirmed",
        metadata: cleanMetadata,
      });
    } else if (node.metadata.action === "create_test_drive_booking") {
      await supabase.from("test_drive_bookings").insert({
        tenant_id: tenantId, customer_id: customerId,
        customer_name: collectedData.customer_name || "",
        phone_number: customerPhone,
        vehicle_model: collectedData.vehicle_model || "",
        preferred_date: isoDate,
        preferred_time: collectedData.preferred_time || "",
        booking_source: bookingSource, status: "confirmed",
        metadata: cleanMetadata,
      });
    }

    // ALWAYS create a lead with full metadata so the dynamic Leads report
    // surfaces every variable the dealer configured in their flow.
    await supabase.from("leads").insert({
      tenant_id: tenantId, customer_id: customerId,
      customer_name: (collectedData.customer_name as string) || customerPhone,
      phone_number: customerPhone,
      email: (collectedData.email as string) || null,
      source: adSource ? "campaign" : "whatsapp",
      vehicle_interest: (collectedData.vehicle_model as string) || null,
      status: "new",
      metadata: cleanMetadata,
    });

    await supabase.from("chatbot_conversations")
      .update({ status: "closed", ended_at: new Date().toISOString() })
      .eq("id", conversationId);
  }

  if (node) {
    let replyText = node.message?.en || "";
    replyText = replyText.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => {
      if (key === "booking_id") return `BK-${Date.now().toString(36).toUpperCase()}`;
      return String(collectedData[key] ?? `[${key}]`);
    });

    // Send the reply (date_buttons → interactive buttons)
    if (node.type === "date_buttons") {
      await sendDateButtons(supabase, tenantId, conversationId, customerPhone, replyText);
    } else if (node.options && node.options.length > 0 && node.options.length <= 3 && node.type !== "condition") {
      await queueReply(supabase, tenantId, conversationId, customerPhone, {
        type: "buttons",
        body: replyText,
        buttons: node.options.slice(0, 3).map((o: any, i: number) => ({
          id: o.value || `opt_${i}`,
          title: (o.label || "").substring(0, 20),
        })),
      });
    } else {
      await queueReply(supabase, tenantId, conversationId, customerPhone, { type: "text", body: replyText });
    }

    await supabase.from("chatbot_messages").insert({
      tenant_id: tenantId, conversation_id: conversationId,
      sender_type: "bot", content: replyText, message_type: "text",
    });

    const nextWait = node.type === "end" ? null : node.id;
    await updateConversationMetadata(supabase, conversationId, flowId, nextWait, collectedData);
    console.log(`[FLOW] processed node=${node.id} (${Date.now() - t0}ms)`);
  }
}

async function sendDateButtons(
  supabase: any, tenantId: string, conversationId: string, recipientPhone: string, body: string,
) {
  const days = nextDays(2, 0); // today + tomorrow
  await queueReply(supabase, tenantId, conversationId, recipientPhone, {
    type: "buttons",
    body,
    buttons: [
      { id: "today", title: `Today (${days[0].ddmmyyyy})`.substring(0, 20) },
      { id: "tomorrow", title: `Tomorrow`.substring(0, 20) },
      { id: "other", title: "Select Other" },
    ],
  });
}

async function updateConversationMetadata(
  supabase: any, conversationId: string,
  flowId: string | null, nodeId: string | null,
  collectedData: Record<string, unknown>,
) {
  await supabase.from("chatbot_conversations")
    .update({ metadata: { current_flow_id: flowId, current_node_id: nodeId, collected_data: collectedData } })
    .eq("id", conversationId);
}

// ============================================================
// QUEUE & SEND (text | buttons | list)
// ============================================================
type ReplyPayload =
  | { type: "text"; body: string }
  | { type: "buttons"; body: string; buttons: { id: string; title: string }[] }
  | { type: "list"; body: string; buttonText: string; rows: { id: string; title: string }[] };

async function queueReply(
  supabase: any, tenantId: string, conversationId: string,
  recipientPhone: string, payload: ReplyPayload,
) {
  const { data: queuedMsg } = await supabase.from("whatsapp_message_queue").insert({
    tenant_id: tenantId, conversation_id: conversationId,
    recipient_phone: recipientPhone, message_type: payload.type,
    content: payload.body, status: "queued",
    template_params: payload.type !== "text" ? (payload as any) : null,
  }).select("id").single();

  try {
    const { data: tenantData } = await supabase.from("tenants")
      .select("whatsapp_config").eq("id", tenantId).single();
    const cfg = (tenantData?.whatsapp_config as any) || {};
    const provider: "meta" | "evolution" = cfg.provider === "evolution" ? "evolution" : "meta";

    if (queuedMsg) {
      await supabase.from("whatsapp_message_queue")
        .update({ status: "sending", attempts: 1, last_attempt_at: new Date().toISOString() })
        .eq("id", queuedMsg.id);
    }

    let response: Response;
    let result: any = {};
    let externalId: string | null = null;

    if (provider === "evolution") {
      const evoUrl: string | undefined = cfg.evolution?.instance_url;
      const evoInstance: string | undefined = cfg.evolution?.instance_name;
      const evoApiKey: string | undefined = cfg.evolution?.api_key;
      if (!evoUrl || !evoInstance || !evoApiKey) {
        console.warn(`[SEND][EVO] Missing Evolution config for tenant ${tenantId}`);
        if (queuedMsg) {
          await supabase.from("whatsapp_message_queue")
            .update({ status: "failed", error_message: "Evolution API not fully configured" })
            .eq("id", queuedMsg.id);
        }
        return;
      }

      // Evolution sendText is plain text; for buttons/list we render a numbered text fallback
      let evoText = payload.body;
      if (payload.type === "buttons") {
        evoText = `${payload.body}\n\n` +
          payload.buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n");
      } else if (payload.type === "list") {
        evoText = `${payload.body}\n\n` +
          payload.rows.map((r, i) => `${i + 1}. ${r.title}`).join("\n");
      }

      const evoEndpoint = `${evoUrl.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(evoInstance)}`;
      console.log(`[SEND][EVO] POST ${evoEndpoint} type=${payload.type}`);
      response = await fetch(evoEndpoint, {
        method: "POST",
        headers: { apikey: evoApiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ number: recipientPhone, text: evoText }),
      });
      result = await response.json().catch(() => ({}));
      externalId = result?.key?.id || result?.id || null;
    } else {
      const accessToken = cfg.meta?.access_token || cfg.access_token;
      if (!accessToken) { console.warn(`[SEND][META] No access token for tenant ${tenantId}`); return; }

      const { data: session } = await supabase.from("whatsapp_sessions")
        .select("phone_number_id").eq("tenant_id", tenantId).eq("is_active", true).single();
      if (!session) { console.warn(`[SEND][META] No active session for tenant ${tenantId}`); return; }

      const metaUrl = `https://graph.facebook.com/v21.0/${session.phone_number_id}/messages`;
      let metaBody: Record<string, unknown>;

      if (payload.type === "text") {
        metaBody = { messaging_product: "whatsapp", to: recipientPhone, type: "text", text: { body: payload.body } };
      } else if (payload.type === "buttons") {
        metaBody = {
          messaging_product: "whatsapp", to: recipientPhone, type: "interactive",
          interactive: {
            type: "button",
            body: { text: payload.body },
            action: { buttons: payload.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.substring(0, 20) } })) },
          },
        };
      } else {
        metaBody = {
          messaging_product: "whatsapp", to: recipientPhone, type: "interactive",
          interactive: {
            type: "list",
            body: { text: payload.body },
            action: {
              button: payload.buttonText.substring(0, 20),
              sections: [{ title: "Options", rows: payload.rows.slice(0, 10).map((r) => ({ id: r.id, title: r.title.substring(0, 24) })) }],
            },
          },
        };
      }

      console.log(`[SEND][META] POST ${metaUrl} type=${payload.type}`);
      response = await fetch(metaUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(metaBody),
      });
      result = await response.json();
      externalId = result?.messages?.[0]?.id || null;
    }

    console.log(`[SEND] status=${response.status} provider=${provider}`);

    if (response.ok && externalId) {
      if (queuedMsg) {
        await supabase.from("whatsapp_message_queue")
          .update({ status: "sent", external_message_id: externalId })
          .eq("id", queuedMsg.id);
      }
    } else if (queuedMsg) {
      await supabase.from("whatsapp_message_queue")
        .update({ status: "failed", error_message: JSON.stringify(result?.error || result || { status: response.status }) })
        .eq("id", queuedMsg.id);
    }
  } catch (err) {
    console.error(`[SEND] error:`, err);
    if (queuedMsg) {
      await supabase.from("whatsapp_message_queue")
        .update({ status: "failed", error_message: String(err) })
        .eq("id", queuedMsg.id);
    }
  }
}

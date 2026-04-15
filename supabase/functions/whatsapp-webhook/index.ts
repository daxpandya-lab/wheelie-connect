import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Rate limit helper - calls DB token bucket
async function checkRateLimit(supabase: any, key: string, maxTokens = 120, windowSeconds = 60): Promise<boolean> {
  const { data } = await supabase.rpc("check_rate_limit", {
    _key: key,
    _max_tokens: maxTokens,
    _refill_rate: 1,
    _window_seconds: windowSeconds,
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
}

interface WhatsAppWebhookEntry {
  id: string;
  changes: Array<{
    value: {
      messaging_product: string;
      metadata: { display_phone_number: string; phone_number_id: string };
      contacts?: Array<{ profile: { name: string }; wa_id: string }>;
      messages?: WhatsAppMessage[];
      statuses?: Array<{ id: string; status: string; timestamp: string; recipient_id: string }>;
    };
    field: string;
  }>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

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
      // Accept hardcoded "lovable" token for Meta verification
      if (token === "lovable") {
        console.log("Webhook verified with default token");
        return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
      }

      // Look up tenant by verify_token
      const { data: session } = await supabase
        .from("whatsapp_sessions")
        .select("id, tenant_id")
        .eq("verify_token", token)
        .eq("is_active", true)
        .single();

      if (session) {
        console.log(`Webhook verified for tenant ${session.tenant_id}`);
        return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
      }
      return new Response("Verification token mismatch", { status: 403 });
    }
    return new Response("OK", { status: 200 });
  }

  // ========== INCOMING MESSAGES (POST) ==========
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const entries: WhatsAppWebhookEntry[] = body.object === "whatsapp_business_account" ? body.entry : [];

      for (const entry of entries) {
        for (const change of entry.changes) {
          if (change.field !== "messages") continue;
          const value = change.value;
          const phoneNumberId = value.metadata.phone_number_id;

          // ===== Rate limit per phone_number_id (120 req/min) =====
          const allowed = await checkRateLimit(supabase, `webhook:${phoneNumberId}`, 120, 60);
          if (!allowed) {
            console.warn(`Rate limited: ${phoneNumberId}`);
            continue;
          }

          // ===== Route to tenant by phone_number_id =====
          const { data: session } = await supabase
            .from("whatsapp_sessions")
            .select("id, tenant_id")
            .eq("phone_number_id", phoneNumberId)
            .eq("is_active", true)
            .single();

          if (!session) {
            console.error(`No tenant found for phone_number_id: ${phoneNumberId}`);
            continue;
          }

          const tenantId = session.tenant_id;

          // Update last webhook timestamp
          await supabase
            .from("whatsapp_sessions")
            .update({ last_webhook_at: new Date().toISOString() })
            .eq("id", session.id);

          // ===== Process status updates =====
          if (value.statuses) {
            for (const status of value.statuses) {
              await supabase
                .from("whatsapp_message_queue")
                .update({ status: status.status as any })
                .eq("external_message_id", status.id)
                .eq("tenant_id", tenantId);
            }
          }

          // ===== Process incoming messages =====
          if (value.messages && value.contacts) {
            for (const msg of value.messages) {
              const contact = value.contacts.find((c) => c.wa_id === msg.from);
              const customerPhone = msg.from;
              const customerName = contact?.profile?.name || customerPhone;

              // Extract message text
              let messageText = "";
              if (msg.type === "text" && msg.text) {
                messageText = msg.text.body;
              } else if (msg.type === "interactive" && msg.interactive) {
                messageText =
                  msg.interactive.button_reply?.title ||
                  msg.interactive.list_reply?.title ||
                  "";
              }

              // ===== Find or create customer =====
              let customerId: string | null = null;
              const { data: existingCustomer } = await supabase
                .from("customers")
                .select("id")
                .eq("tenant_id", tenantId)
                .eq("phone", customerPhone)
                .single();

              if (existingCustomer) {
                customerId = existingCustomer.id;
              } else {
                const { data: newCustomer } = await supabase
                  .from("customers")
                  .insert({
                    tenant_id: tenantId,
                    name: customerName,
                    phone: customerPhone,
                  })
                  .select("id")
                  .single();
                customerId = newCustomer?.id || null;
              }

              // ===== Find or create conversation =====
              const { data: existingConvo } = await supabase
                .from("chatbot_conversations")
                .select("id, metadata")
                .eq("tenant_id", tenantId)
                .eq("phone_number", customerPhone)
                .eq("status", "active")
                .order("started_at", { ascending: false })
                .limit(1)
                .single();

              let conversationId: string;
              let conversationMetadata: Record<string, unknown> = {};

              if (existingConvo) {
                conversationId = existingConvo.id;
                conversationMetadata = (existingConvo.metadata as Record<string, unknown>) || {};
              } else {
                const { data: newConvo } = await supabase
                  .from("chatbot_conversations")
                  .insert({
                    tenant_id: tenantId,
                    customer_id: customerId,
                    channel: "whatsapp",
                    phone_number: customerPhone,
                    status: "active",
                    metadata: { current_flow_id: null, current_node_id: null, collected_data: {} },
                  })
                  .select("id, metadata")
                  .single();
                conversationId = newConvo!.id;
                conversationMetadata = (newConvo!.metadata as Record<string, unknown>) || {};
              }

              // ===== Store incoming message =====
              const { data: savedMessage } = await supabase
                .from("chatbot_messages")
                .insert({
                  tenant_id: tenantId,
                  conversation_id: conversationId,
                  sender_type: "customer",
                  content: messageText,
                  message_type: msg.type === "interactive" ? "text" : msg.type,
                  metadata: { wa_message_id: msg.id, wa_timestamp: msg.timestamp },
                })
                .select("id")
                .single();

              // ===== Process through chatbot flow =====
              await processChatbotFlow(
                supabase,
                tenantId,
                conversationId,
                savedMessage!.id,
                messageText,
                customerPhone,
                conversationMetadata,
                customerId
              );
            }
          }
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error("Webhook error:", error);
      return new Response(JSON.stringify({ error: "Internal error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response("Method not allowed", { status: 405 });
});

// ===== CHATBOT FLOW PROCESSOR =====
async function processChatbotFlow(
  supabase: any,
  tenantId: string,
  conversationId: string,
  messageId: string,
  userMessage: string,
  customerPhone: string,
  metadata: Record<string, unknown>,
  customerId: string | null
) {
  const currentFlowId = metadata.current_flow_id as string | null;
  const currentNodeId = metadata.current_node_id as string | null;
  const collectedData = (metadata.collected_data as Record<string, unknown>) || {};

  // If no active flow, find default active flow
  let flowId = currentFlowId;
  let flowData: any = null;

  if (!flowId) {
    const { data: activeFlow } = await supabase
      .from("chatbot_flows")
      .select("id, flow_data")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(1)
      .single();

    if (!activeFlow) {
      // No active flow — queue a default reply
      await queueReply(supabase, tenantId, conversationId, customerPhone,
        "Thank you for your message. Our team will get back to you shortly.");
      return;
    }
    flowId = activeFlow.id;
    flowData = activeFlow.flow_data;
  } else {
    const { data: flow } = await supabase
      .from("chatbot_flows")
      .select("flow_data")
      .eq("id", flowId)
      .single();
    flowData = flow?.flow_data;
  }

  if (!flowData || !flowData.nodes) return;

  const nodes = flowData.nodes;
  let nodeId = currentNodeId || flowData.startNodeId;
  let node = nodes.find((n: any) => n.id === nodeId);

  if (!node) return;

  // If we're waiting for user input at this node, process the answer
  if (currentNodeId && node) {
    // Store collected data
    if (node.dataField) {
      if (node.validationType === "number") {
        collectedData[node.dataField] = parseInt(userMessage) || 0;
      } else if (node.dataField === "pickup_required") {
        collectedData["pickup_required"] = userMessage.toLowerCase().includes("yes") || userMessage.toLowerCase().includes("both") || userMessage.toLowerCase().includes("pickup");
        collectedData["drop_required"] = userMessage.toLowerCase().includes("yes") || userMessage.toLowerCase().includes("both") || userMessage.toLowerCase().includes("drop");
      } else {
        collectedData[node.dataField] = userMessage;
      }
    }

    // Log response for analytics
    await supabase.from("chatbot_responses").insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      message_id: messageId,
      flow_id: flowId,
      intent_detected: node.dataField || node.type,
      confidence_score: 1.0,
      response_text: userMessage,
      response_time_ms: 0,
    });

    // Determine next node
    let nextNodeId: string | undefined;
    if (node.options) {
      const match = node.options.find((o: any) =>
        o.value.toLowerCase() === userMessage.toLowerCase() ||
        o.label.toLowerCase() === userMessage.toLowerCase()
      );
      nextNodeId = match?.nextNodeId || node.options[0]?.nextNodeId || node.nextNodeId;
    } else {
      nextNodeId = node.nextNodeId;
    }

    if (!nextNodeId) {
      // Flow complete
      await updateConversationMetadata(supabase, conversationId, null, null, collectedData);
      return;
    }

    node = nodes.find((n: any) => n.id === nextNodeId);
    nodeId = nextNodeId;
  }

  if (!node) return;

  // Handle special node types
  if (node.type === "api_check") {
    // Slot availability check
    if (node.metadata?.checkType === "slot_availability" && collectedData.preferred_date) {
      const { count } = await supabase
        .from("service_bookings")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("booking_date", collectedData.preferred_date);

      const maxSlots = (node.metadata.maxSlotsPerDay as number) || 10;
      const isAvailable = (count || 0) < maxSlots;

      if (!isAvailable && node.nextNodeId) {
        // Go to condition node and pick "full" path
        const conditionNode = nodes.find((n: any) => n.id === node!.nextNodeId);
        if (conditionNode?.options) {
          const fullOption = conditionNode.options.find((o: any) => o.value === "full");
          if (fullOption) {
            node = nodes.find((n: any) => n.id === fullOption.nextNodeId);
            nodeId = fullOption.nextNodeId;
          }
        }
      } else if (node.nextNodeId) {
        const conditionNode = nodes.find((n: any) => n.id === node!.nextNodeId);
        if (conditionNode?.options) {
          const availOption = conditionNode.options.find((o: any) => o.value === "available");
          if (availOption) {
            node = nodes.find((n: any) => n.id === availOption.nextNodeId);
            nodeId = availOption.nextNodeId;
          }
        }
      }
    }
  }

  // Handle end node — create booking
  if (node?.type === "end" && node.metadata?.action) {
    if (node.metadata.action === "create_service_booking") {
      await supabase.from("service_bookings").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        customer_name: collectedData.customer_name || "",
        phone_number: customerPhone,
        vehicle_model: collectedData.vehicle_model || "",
        kms_driven: collectedData.kms_driven ? Number(collectedData.kms_driven) : null,
        service_type: collectedData.service_type || "General Service",
        booking_date: collectedData.preferred_date || new Date().toISOString().split("T")[0],
        pickup_required: !!collectedData.pickup_required,
        drop_required: !!collectedData.drop_required,
        notes: collectedData.issue_description || "",
        booking_source: "ai_bot",
        status: "confirmed",
      });
    } else if (node.metadata.action === "create_test_drive_booking") {
      await supabase.from("test_drive_bookings").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        customer_name: collectedData.customer_name || "",
        phone_number: customerPhone,
        vehicle_model: collectedData.vehicle_model || "",
        preferred_date: collectedData.preferred_date || new Date().toISOString().split("T")[0],
        preferred_time: collectedData.preferred_time || "",
        booking_source: "ai_bot",
        status: "confirmed",
      });

      // Also create a lead
      await supabase.from("leads").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        customer_name: collectedData.customer_name || "",
        phone_number: customerPhone,
        email: collectedData.email || "",
        source: "whatsapp",
        vehicle_interest: collectedData.vehicle_model || "",
        status: "new",
      });
    }

    // Close conversation
    await supabase
      .from("chatbot_conversations")
      .update({ status: "closed", ended_at: new Date().toISOString() })
      .eq("id", conversationId);
  }

  // Send reply message
  if (node) {
    let replyText = node.message?.en || "";
    // Interpolate collected data
    replyText = replyText.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => {
      if (key === "booking_id") return `BK-${Date.now().toString(36).toUpperCase()}`;
      return String(collectedData[key] || `[${key}]`);
    });

    // Queue the reply
    await queueReply(supabase, tenantId, conversationId, customerPhone, replyText);

    // Store bot message
    await supabase.from("chatbot_messages").insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_type: "bot",
      content: replyText,
      message_type: "text",
    });

    // Update conversation metadata with current position
    const nextWaitNode = node.type === "end" ? null : node.id;
    await updateConversationMetadata(supabase, conversationId, flowId, nextWaitNode, collectedData);
  }
}

async function updateConversationMetadata(
  supabase: any,
  conversationId: string,
  flowId: string | null,
  nodeId: string | null,
  collectedData: Record<string, unknown>
) {
  await supabase
    .from("chatbot_conversations")
    .update({
      metadata: {
        current_flow_id: flowId,
        current_node_id: nodeId,
        collected_data: collectedData,
      },
    })
    .eq("id", conversationId);
}

async function queueReply(
  supabase: any,
  tenantId: string,
  conversationId: string,
  recipientPhone: string,
  content: string
) {
  // Insert into queue first
  const { data: queuedMsg } = await supabase.from("whatsapp_message_queue").insert({
    tenant_id: tenantId,
    conversation_id: conversationId,
    recipient_phone: recipientPhone,
    message_type: "text",
    content: content,
    status: "queued",
  }).select("id").single();

  // Attempt immediate delivery via Meta Cloud API
  try {
    // Get tenant's WhatsApp config
    const { data: tenantData } = await supabase
      .from("tenants")
      .select("whatsapp_config")
      .eq("id", tenantId)
      .single();

    const waConfig = tenantData?.whatsapp_config as Record<string, string> | null;
    const accessToken = waConfig?.access_token;

    if (!accessToken) {
      console.warn(`No WhatsApp access token for tenant ${tenantId}`);
      return;
    }

    // Get phone_number_id
    const { data: session } = await supabase
      .from("whatsapp_sessions")
      .select("phone_number_id")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .single();

    if (!session) {
      console.warn(`No active WhatsApp session for tenant ${tenantId}`);
      return;
    }

    // Mark as sending
    if (queuedMsg) {
      await supabase
        .from("whatsapp_message_queue")
        .update({ status: "sending", attempts: 1, last_attempt_at: new Date().toISOString() })
        .eq("id", queuedMsg.id);
    }

    // Send via Meta Cloud API
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${session.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipientPhone,
          type: "text",
          text: { body: content },
        }),
      }
    );

    const result = await response.json();

    if (response.ok && result.messages?.[0]?.id) {
      console.log(`Message sent to ${recipientPhone}: ${result.messages[0].id}`);
      if (queuedMsg) {
        await supabase
          .from("whatsapp_message_queue")
          .update({ status: "sent", external_message_id: result.messages[0].id })
          .eq("id", queuedMsg.id);
      }
    } else {
      console.error(`Failed to send to ${recipientPhone}:`, JSON.stringify(result.error || result));
      if (queuedMsg) {
        await supabase
          .from("whatsapp_message_queue")
          .update({ status: "failed", error_message: JSON.stringify(result.error || result) })
          .eq("id", queuedMsg.id);
      }
    }
  } catch (err) {
    console.error(`Send error for ${recipientPhone}:`, err);
    if (queuedMsg) {
      await supabase
        .from("whatsapp_message_queue")
        .update({ status: "failed", error_message: String(err) })
        .eq("id", queuedMsg.id);
    }
  }
}

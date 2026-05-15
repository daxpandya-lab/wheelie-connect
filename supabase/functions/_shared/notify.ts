// Channel-agnostic notification dispatcher.
//
// Routes outbound customer messages (reminders, estimates, ready-for-pickup,
// CSAT, etc.) to the right channel based on the booking's origin and the
// tenant's WhatsApp configuration:
//
//   - booking_source === "web_bot"  -> insert into the chatbot timeline so
//     it renders inside the embedded web chat / app webview.
//   - whatsapp_config.provider === "meta"      -> Meta Cloud API. If a
//     templateName is provided, variables are mapped to the official
//     `template.components` parameter format. Otherwise an interactive
//     button / text / document message is sent.
//   - whatsapp_config.provider === "evolution" -> Evolution API. Markdown
//     text + native button arrays + sendMedia for documents.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type NotifyKind = "text" | "buttons" | "document";

export interface NotifyButton {
  id: string;
  title: string;
}

export interface NotifyPayload {
  kind: NotifyKind;
  text: string;                    // body for text/buttons; caption for document
  buttons?: NotifyButton[];        // for kind === "buttons"
  document?: { url: string; filename: string };
  // Meta template path
  templateName?: string;
  templateLanguage?: string;       // default "en"
  templateVariables?: Array<string | number>;
}

export interface NotifyContext {
  tenantId: string;
  bookingId?: string;
  bookingSource?: string | null;   // service_bookings.booking_source
  phoneNumber?: string | null;
  conversationId?: string | null;  // chatbot_conversations.id (web bot)
}

export interface NotifyResult {
  channel: "web_bot" | "meta" | "evolution" | "none";
  status: "sent" | "skipped" | "failed";
  error?: string;
}

const META_VERSION = "v21.0";

function isWebBot(source?: string | null): boolean {
  if (!source) return false;
  const s = source.toLowerCase();
  return s === "web_bot" || s === "web" || s === "webbot" || s === "embed";
}

async function findOrCreateWebConversation(
  supabase: SupabaseClient,
  ctx: NotifyContext,
): Promise<string | null> {
  if (ctx.conversationId) return ctx.conversationId;
  if (!ctx.phoneNumber) return null;
  const { data } = await supabase
    .from("chatbot_conversations")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("phone_number", ctx.phoneNumber)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.id) return data.id as string;
  const { data: created, error } = await supabase
    .from("chatbot_conversations")
    .insert({
      tenant_id: ctx.tenantId,
      phone_number: ctx.phoneNumber,
      channel: "web",
      status: "active",
    } as never)
    .select("id")
    .single();
  if (error) {
    console.warn("[notify] could not create web conversation", error.message);
    return null;
  }
  return (created as { id: string }).id;
}

async function dispatchWebBot(
  supabase: SupabaseClient,
  ctx: NotifyContext,
  payload: NotifyPayload,
): Promise<NotifyResult> {
  const conversationId = await findOrCreateWebConversation(supabase, ctx);
  if (!conversationId) {
    return { channel: "web_bot", status: "skipped", error: "no conversation" };
  }
  const metadata: Record<string, unknown> = { kind: payload.kind };
  if (payload.buttons?.length) metadata.buttons = payload.buttons;
  if (payload.document) metadata.document = payload.document;
  if (ctx.bookingId) metadata.booking_id = ctx.bookingId;

  const { error } = await supabase.from("chatbot_messages").insert({
    tenant_id: ctx.tenantId,
    conversation_id: conversationId,
    sender_type: "bot",
    message_type: payload.kind === "document" ? "media" : "text",
    content: payload.text,
    metadata,
  } as never);
  if (error) return { channel: "web_bot", status: "failed", error: error.message };
  return { channel: "web_bot", status: "sent" };
}

async function dispatchMeta(
  wa: Record<string, any>,
  ctx: NotifyContext,
  payload: NotifyPayload,
): Promise<NotifyResult> {
  const token = wa.meta?.access_token || wa.access_token;
  const phoneNumberId = wa.meta?.phone_number_id;
  if (!token || !phoneNumberId || !ctx.phoneNumber) {
    return { channel: "meta", status: "skipped", error: "meta not configured" };
  }
  const endpoint = `https://graph.facebook.com/${META_VERSION}/${phoneNumberId}/messages`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  let body: Record<string, unknown>;
  if (payload.templateName) {
    body = {
      messaging_product: "whatsapp",
      to: ctx.phoneNumber,
      type: "template",
      template: {
        name: payload.templateName,
        language: { code: payload.templateLanguage || "en" },
        components: (payload.templateVariables ?? []).length
          ? [{
              type: "body",
              parameters: (payload.templateVariables ?? []).map((v) => ({
                type: "text",
                text: String(v),
              })),
            }]
          : [],
      },
    };
  } else if (payload.kind === "document" && payload.document) {
    body = {
      messaging_product: "whatsapp",
      to: ctx.phoneNumber,
      type: "document",
      document: {
        link: payload.document.url,
        filename: payload.document.filename,
        caption: payload.text,
      },
    };
  } else if (payload.kind === "buttons" && payload.buttons?.length) {
    body = {
      messaging_product: "whatsapp",
      to: ctx.phoneNumber,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: payload.text },
        action: {
          buttons: payload.buttons.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    };
  } else {
    body = {
      messaging_product: "whatsapp",
      to: ctx.phoneNumber,
      type: "text",
      text: { body: payload.text },
    };
  }

  try {
    const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    if (!r.ok) {
      const err = (await r.text()).slice(0, 400);
      return { channel: "meta", status: "failed", error: err };
    }
    return { channel: "meta", status: "sent" };
  } catch (e) {
    return { channel: "meta", status: "failed", error: String(e).slice(0, 300) };
  }
}

async function dispatchEvolution(
  wa: Record<string, any>,
  ctx: NotifyContext,
  payload: NotifyPayload,
): Promise<NotifyResult> {
  const evoUrl = wa.evolution?.instance_url;
  const instance = wa.evolution?.instance_name;
  const apiKey = wa.evolution?.api_key;
  if (!evoUrl || !instance || !apiKey || !ctx.phoneNumber) {
    return { channel: "evolution", status: "skipped", error: "evolution not configured" };
  }
  const headers = { apikey: apiKey, "Content-Type": "application/json" };
  const base = `${evoUrl}/message`;
  const enc = encodeURIComponent(instance);

  try {
    let r: Response;
    if (payload.kind === "buttons" && payload.buttons?.length) {
      r = await fetch(`${base}/sendButtons/${enc}`, {
        method: "POST", headers,
        body: JSON.stringify({
          number: ctx.phoneNumber,
          title: " ",
          description: payload.text,
          footer: " ",
          buttons: payload.buttons.map((b) => ({
            type: "reply", displayText: b.title, id: b.id,
          })),
        }),
      });
    } else if (payload.kind === "document" && payload.document) {
      // Send caption text first, then the document.
      if (payload.text) {
        await fetch(`${base}/sendText/${enc}`, {
          method: "POST", headers,
          body: JSON.stringify({ number: ctx.phoneNumber, text: payload.text }),
        });
      }
      r = await fetch(`${base}/sendMedia/${enc}`, {
        method: "POST", headers,
        body: JSON.stringify({
          number: ctx.phoneNumber,
          mediatype: "document",
          fileName: payload.document.filename,
          media: payload.document.url,
          caption: payload.text,
        }),
      });
    } else {
      r = await fetch(`${base}/sendText/${enc}`, {
        method: "POST", headers,
        body: JSON.stringify({ number: ctx.phoneNumber, text: payload.text }),
      });
    }
    if (!r.ok) {
      const err = (await r.text()).slice(0, 400);
      return { channel: "evolution", status: "failed", error: err };
    }
    return { channel: "evolution", status: "sent" };
  } catch (e) {
    return { channel: "evolution", status: "failed", error: String(e).slice(0, 300) };
  }
}

/**
 * Substitute {{var}} placeholders in a string using the provided variables.
 */
export function renderVariables(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  if (!template) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => {
    const v = vars[k.toLowerCase()];
    return v == null || v === "" ? `{{${k}}}` : String(v);
  });
}

/**
 * Single entry-point used by every outbound flow. The caller does not need
 * to know which channel is active for the tenant.
 */
export async function dispatchNotification(
  supabase: SupabaseClient,
  ctx: NotifyContext,
  payload: NotifyPayload,
): Promise<NotifyResult> {
  // 1. Web bot wins when the booking originated from the embedded chat.
  if (isWebBot(ctx.bookingSource)) {
    return dispatchWebBot(supabase, ctx, payload);
  }

  // 2. Otherwise route through the tenant's configured WhatsApp provider.
  const { data: tenant } = await supabase
    .from("tenants")
    .select("whatsapp_config, status")
    .eq("id", ctx.tenantId)
    .maybeSingle();
  if (!tenant || tenant.status !== "active") {
    return { channel: "none", status: "skipped", error: "tenant inactive" };
  }
  const wa = (tenant.whatsapp_config as Record<string, any>) || {};
  const provider: "meta" | "evolution" =
    wa.provider === "evolution" ? "evolution" : "meta";

  if (provider === "evolution") return dispatchEvolution(wa, ctx, payload);
  return dispatchMeta(wa, ctx, payload);
}

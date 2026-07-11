import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildMediaAttachment } from "../_shared/media-attachment.ts";
import { cleanPhoneNumber, sendPresence, humanTypingDelayMs, sleep } from "../_shared/wa-evolution.ts";

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

// ============================================================
// SERVICE-ESTIMATE button handler
// Intercepts interactive replies of the form `est_approve_<id>` / `est_reject_<id>`.
// Returns true if the reply was an estimate decision (caller should stop further flow).
// ============================================================
async function handleEstimateButton(
  supabase: any,
  tenantId: string,
  recipientPhone: string,
  interactiveId: string | null,
  whatsappConfig: Record<string, any>,
): Promise<boolean> {
  if (!interactiveId) return false;
  const m = interactiveId.match(/^est_(approve|reject|call)_([0-9a-f-]{36})$/);
  if (!m) return false;
  const action = m[1] as "approve" | "reject" | "call";
  const bookingId = m[2];

  const { data: booking } = await supabase
    .from("service_bookings")
    .select("id, tenant_id, approval_status, customer_approval_status, assigned_to, metadata")
    .eq("id", bookingId).maybeSingle();
  if (!booking || booking.tenant_id !== tenantId) return false;

  const customerState = action === "approve" ? "approved" : action === "reject" ? "rejected" : "call_requested";
  const approvalLegacy = action === "approve" ? "approved" : action === "reject" ? "rejected" : "pending";

  if ((booking.customer_approval_status || "pending_approval") === "pending_approval") {
    const mergedMeta = {
      ...(booking.metadata && typeof booking.metadata === "object" ? booking.metadata : {}),
      approval_source: "whatsapp_webhook",
      approval_action: action,
      approval_responded_at: new Date().toISOString(),
    };
    const patch: Record<string, unknown> = {
      approval_status: approvalLegacy,
      customer_approval_status: customerState,
      metadata: mergedMeta,
    };
    if (action === "approve") patch.status = "in_progress";
    await supabase.from("service_bookings").update(patch).eq("id", bookingId);


    // Notify assigned advisor
    if (booking.assigned_to) {
      const title = action === "approve" ? "Estimate approved"
        : action === "reject" ? "Estimate rejected"
        : "Customer requested a call";
      const message = action === "approve" ? "Customer approved the estimate on WhatsApp. Work can begin."
        : action === "reject" ? "Customer rejected the estimate on WhatsApp."
        : "Customer asked you to call them about the estimate.";
      await supabase.from("notifications").insert({
        tenant_id: tenantId,
        user_id: booking.assigned_to,
        title,
        message,
        type: action === "approve" ? "success" : action === "reject" ? "warning" : "info",
        source: "service_booking",
        source_id: bookingId,
      });
    }
  }

  const reply = action === "approve"
    ? "✅ Estimate Approved. We have started the work! You will be notified once the vehicle is ready."
    : action === "reject"
    ? "❌ Estimate noted as rejected. Our advisor will follow up shortly."
    : "📞 Got it — our service advisor will call you shortly.";


  const provider: "meta" | "evolution" = whatsappConfig.provider === "evolution" ? "evolution" : "meta";
  try {
    if (provider === "evolution") {
      const evoUrl = (whatsappConfig.evolution?.instance_url || Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/+$/, "");
      const evoInstance = whatsappConfig.evolution?.instance_name;
      const evoApiKey = whatsappConfig.evolution?.api_key || Deno.env.get("EVOLUTION_API_KEY") || "";
      const cleaned = cleanPhoneNumber(recipientPhone);
      if (evoUrl && evoInstance && evoApiKey && cleaned) {
        await sendPresence(evoUrl, evoInstance, evoApiKey, cleaned);
        await sleep(humanTypingDelayMs(reply));
        await fetch(`${evoUrl}/message/sendText/${encodeURIComponent(evoInstance)}`, {
          method: "POST",
          headers: { apikey: evoApiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ number: cleaned, text: reply }),
        });
      }
    } else {
      const accessToken = whatsappConfig.meta?.access_token || whatsappConfig.access_token;
      const phoneNumberId = whatsappConfig.meta?.phone_number_id;
      if (accessToken && phoneNumberId) {
        await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: recipientPhone,
            type: "text",
            text: { body: reply },
          }),
        });
      }
    }
  } catch (e) {
    console.error("[estimate-reply] failed to send", e);
  }
  return true;
}

// ============================================================
// CSAT button handler — intercepts `csat_<rating>_<bookingId>` replies
// Records rating, alerts manager if <3, sends Google review link if 5.
// ============================================================
async function handleCsatButton(
  supabase: any,
  tenantId: string,
  recipientPhone: string,
  interactiveId: string | null,
  whatsappConfig: Record<string, any>,
  tenantSettings: Record<string, any>,
  tenantName: string,
): Promise<boolean> {
  if (!interactiveId) return false;
  const m = interactiveId.match(/^csat_([1-5])_([0-9a-f-]{36})$/);
  if (!m) return false;
  const rating = parseInt(m[1], 10);
  const bookingId = m[2];

  const { data: booking } = await supabase
    .from("service_bookings")
    .select("id, tenant_id, customer_name, vehicle_model")
    .eq("id", bookingId).maybeSingle();
  if (!booking || booking.tenant_id !== tenantId) return false;

  await supabase.from("csat_responses").insert({
    tenant_id: tenantId, booking_id: bookingId, booking_type: "service", rating,
  });

  const reviewUrl = String(tenantSettings?.google_review_url || "").trim();
  const managerPhone = String(tenantSettings?.manager_phone || "").trim();

  let reply: string;
  if (rating >= 5 && reviewUrl) {
    reply = `🙏 Thank you for the 5-star rating! Would you mind sharing your experience on Google?\n${reviewUrl}`;
  } else if (rating >= 4) {
    reply = "🙏 Thank you for your feedback! We're glad you had a good experience.";
  } else {
    reply = "We're sorry to hear that. Our service manager will reach out to make things right.";
  }

  const provider: "meta" | "evolution" = whatsappConfig.provider === "evolution" ? "evolution" : "meta";
  const sendText = async (to: string, body: string) => {
    try {
      if (provider === "evolution") {
        const url = (whatsappConfig.evolution?.instance_url || Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/+$/, "");
        const inst = whatsappConfig.evolution?.instance_name;
        const key = whatsappConfig.evolution?.api_key || Deno.env.get("EVOLUTION_API_KEY") || "";
        const cleaned = cleanPhoneNumber(to);
        if (url && inst && key && cleaned) {
          await sendPresence(url, inst, key, cleaned);
          await sleep(humanTypingDelayMs(body));
          await fetch(`${url}/message/sendText/${encodeURIComponent(inst)}`, {
            method: "POST",
            headers: { apikey: key, "Content-Type": "application/json" },
            body: JSON.stringify({ number: cleaned, text: body }),
          });
        }
      } else if (provider === "meta") {
        const token = whatsappConfig.meta?.access_token || whatsappConfig.access_token;
        const phoneNumberId = whatsappConfig.meta?.phone_number_id;
        if (token && phoneNumberId) {
          await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
          });
        }
      }
    } catch (e) { console.error("[csat] send failed", e); }
  };

  await sendText(recipientPhone, reply);

  // Low rating — alert manager (in-app + WhatsApp)
  if (rating < 3) {
    await supabase.from("notifications").insert({
      tenant_id: tenantId,
      user_id: null,
      title: "Low CSAT rating received",
      message: `${booking.customer_name} (${booking.vehicle_model}) rated ${rating}/5. Please follow up.`,
      type: "warning",
      source: "service_booking",
      source_id: bookingId,
    });
    if (managerPhone) {
      await sendText(
        managerPhone,
        `⚠️ ${tenantName}: Low CSAT alert — ${booking.customer_name} (${booking.vehicle_model}) rated ${rating}/5. Please follow up.`,
      );
    }
  }

  return true;
}

// ============================================================
// PRE-APPOINTMENT CHECK-IN handlers
// Button IDs:
//   chk_comments_<id>         -> ask customer to type comments
//   chk_photos_<id>           -> ask customer to upload photos
//   chk_cancel_<id>           -> initiate cancel flow (with <4h late-protection)
//   chk_confirm_cancel_<id>   -> finalize cancellation
//   chk_keep_<id>             -> abort cancellation
// Follow-up state machine via service_bookings.checkin_state:
//   "awaiting_comments" | "awaiting_photos" | "awaiting_cancel_confirm"
// ============================================================
const CHECKIN_BUTTON_RE = /^chk_(comments|photos|cancel|confirm_cancel|keep)_([0-9a-f-]{36})$/;

async function sendWaText(
  whatsappConfig: Record<string, any>,
  to: string,
  text: string,
): Promise<void> {
  const provider: "meta" | "evolution" =
    whatsappConfig.provider === "evolution" ? "evolution" : "meta";
  try {
    if (provider === "evolution") {
      const url = whatsappConfig.evolution?.instance_url;
      const inst = whatsappConfig.evolution?.instance_name;
      const key = whatsappConfig.evolution?.api_key;
      if (!url || !inst || !key) return;
      await fetch(`${url}/message/sendText/${encodeURIComponent(inst)}`, {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ number: to, text }),
      });
    } else {
      const token = whatsappConfig.meta?.access_token || whatsappConfig.access_token;
      const pnid = whatsappConfig.meta?.phone_number_id;
      if (!token || !pnid) return;
      await fetch(`https://graph.facebook.com/v21.0/${pnid}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", to, type: "text", text: { body: text },
        }),
      });
    }
  } catch (e) { console.error("[checkin] send text failed", e); }
}

async function sendWaButtons(
  whatsappConfig: Record<string, any>,
  to: string,
  text: string,
  buttons: { id: string; title: string }[],
): Promise<void> {
  const provider: "meta" | "evolution" =
    whatsappConfig.provider === "evolution" ? "evolution" : "meta";
  try {
    if (provider === "evolution") {
      const url = whatsappConfig.evolution?.instance_url;
      const inst = whatsappConfig.evolution?.instance_name;
      const key = whatsappConfig.evolution?.api_key;
      if (!url || !inst || !key) return;
      await fetch(`${url}/message/sendButtons/${encodeURIComponent(inst)}`, {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({
          number: to, title: " ", description: text, footer: " ",
          buttons: buttons.map((b) => ({ type: "reply", displayText: b.title, id: b.id })),
        }),
      });
    } else {
      const token = whatsappConfig.meta?.access_token || whatsappConfig.access_token;
      const pnid = whatsappConfig.meta?.phone_number_id;
      if (!token || !pnid) return;
      await fetch(`https://graph.facebook.com/v21.0/${pnid}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp", to, type: "interactive",
          interactive: {
            type: "button",
            body: { text },
            action: {
              buttons: buttons.slice(0, 3).map((b) => ({
                type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) },
              })),
            },
          },
        }),
      });
    }
  } catch (e) { console.error("[checkin] send buttons failed", e); }
}

async function handleCheckinButton(
  supabase: any,
  tenantId: string,
  recipientPhone: string,
  interactiveId: string | null,
  whatsappConfig: Record<string, any>,
  tenantSettings: Record<string, any>,
): Promise<boolean> {
  if (!interactiveId) return false;
  const m = interactiveId.match(CHECKIN_BUTTON_RE);
  if (!m) return false;
  const action = m[1] as "comments" | "photos" | "cancel" | "confirm_cancel" | "keep";
  const bookingId = m[2];

  const { data: booking } = await supabase
    .from("service_bookings")
    .select("id, tenant_id, customer_name, vehicle_model, phone_number, booking_date, preferred_time, status, assigned_to, checkin_state")
    .eq("id", bookingId).maybeSingle();
  if (!booking || booking.tenant_id !== tenantId) return false;

  const firstName = (booking.customer_name || "there").split(" ")[0];

  if (action === "comments") {
    await supabase.from("service_bookings")
      .update({ checkin_state: "awaiting_comments" }).eq("id", bookingId);
    await sendWaText(whatsappConfig, recipientPhone,
      `Sure ${firstName} 📝 — please type any comments, concerns, or symptoms you'd like our technician to know about. Your next message will be attached to your booking.`);
    return true;
  }

  if (action === "photos") {
    await supabase.from("service_bookings")
      .update({ checkin_state: "awaiting_photos" }).eq("id", bookingId);
    await sendWaText(whatsappConfig, recipientPhone,
      `Great 📸 — please upload photos of any dents, scratches, or dashboard warning lights. You can send as many images as you like.`);
    return true;
  }

  if (action === "cancel") {
    // <4h late protection
    const apptDate: string = booking.booking_date;
    const time: string = booking.preferred_time || "09:00";
    const apptTs = Date.parse(`${apptDate}T${time.length === 5 ? time + ":00" : time}Z`);
    const hoursAway = (apptTs - Date.now()) / 3600000;
    if (Number.isFinite(hoursAway) && hoursAway < 4) {
      const supportPhone = String(tenantSettings?.support_phone || tenantSettings?.manager_phone || "the workshop").trim();
      await sendWaText(whatsappConfig, recipientPhone,
        `Since your appointment is less than 4 hours away, our diagnostic bay is already prepared. Please call the workshop directly at ${supportPhone} to reschedule.`);
      return true;
    }
    await supabase.from("service_bookings")
      .update({ checkin_state: "awaiting_cancel_confirm" }).eq("id", bookingId);
    await sendWaButtons(whatsappConfig, recipientPhone,
      `⚠️ Are you absolutely sure you want to cancel your service appointment for tomorrow? Canceling will release your diagnostic bay slot.`,
      [
        { id: `chk_confirm_cancel_${bookingId}`, title: "Yes, Cancel It" },
        { id: `chk_keep_${bookingId}`,            title: "No, Keep Booking" },
      ],
    );
    return true;
  }

  if (action === "confirm_cancel") {
    if (booking.status === "cancelled") {
      await sendWaText(whatsappConfig, recipientPhone, `Your appointment is already cancelled.`);
      return true;
    }
    await supabase.from("service_bookings")
      .update({ status: "cancelled", checkin_state: null })
      .eq("id", bookingId);
    // Notify dealer
    await supabase.from("notifications").insert({
      tenant_id: tenantId,
      user_id: booking.assigned_to ?? null,
      title: "Appointment cancelled by customer",
      message: `${booking.customer_name || "Customer"} (${booking.vehicle_model || "vehicle"}) cancelled their service appointment scheduled for ${booking.booking_date}.`,
      type: "warning",
      source: "service_booking",
      source_id: bookingId,
    });
    await sendWaText(whatsappConfig, recipientPhone,
      `Your appointment has been cancelled. We hope to see you again soon — book anytime when you're ready.`);
    return true;
  }

  if (action === "keep") {
    await supabase.from("service_bookings")
      .update({ checkin_state: null }).eq("id", bookingId);
    await sendWaText(whatsappConfig, recipientPhone,
      `👍 Great — your appointment for tomorrow is still confirmed. See you then!`);
    return true;
  }

  return false;
}

// Returns true if the inbound text/media was consumed as a check-in follow-up.
async function handleCheckinFollowup(
  supabase: any,
  tenantId: string,
  recipientPhone: string,
  text: string,
  hasMedia: boolean,
  whatsappConfig: Record<string, any>,
): Promise<boolean> {
  const { data: booking } = await supabase
    .from("service_bookings")
    .select("id, tenant_id, checkin_state, customer_notes")
    .eq("tenant_id", tenantId)
    .eq("phone_number", recipientPhone)
    .not("checkin_state", "is", null)
    .order("booking_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!booking) return false;

  if (booking.checkin_state === "awaiting_comments" && text && !hasMedia) {
    const prev = booking.customer_notes ? `${booking.customer_notes}\n` : "";
    await supabase.from("service_bookings")
      .update({
        customer_notes: `${prev}${text}`.slice(0, 4000),
        checkin_state: null,
      })
      .eq("id", booking.id);
    await sendWaText(whatsappConfig, recipientPhone,
      `✅ Thanks — your comments have been added to your booking. Our technician will review them before your appointment.`);
    return true;
  }

  if (booking.checkin_state === "awaiting_photos" && hasMedia) {
    // The media has already been attached to the booking by attachMediaToActiveBooking.
    // Acknowledge but keep state so the customer can send more photos.
    await sendWaText(whatsappConfig, recipientPhone,
      `✅ Photo received and attached to your booking. Send more if you'd like, or reply "done" when finished.`);
    return true;
  }

  if (booking.checkin_state === "awaiting_photos" && text && /^\s*done\s*$/i.test(text)) {
    await supabase.from("service_bookings")
      .update({ checkin_state: null }).eq("id", booking.id);
    await sendWaText(whatsappConfig, recipientPhone,
      `👍 All set — thanks for sharing those photos. See you tomorrow!`);
    return true;
  }

  return false;
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
// MEDIA — download from WhatsApp providers and store in `service_media`
// ============================================================
function extOf(mime: string, fallback = "bin"): string {
  if (!mime) return fallback;
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/ogg": "ogg", "audio/opus": "opus", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/aac": "aac", "audio/wav": "wav",
    "video/mp4": "mp4", "video/3gpp": "3gp",
    "application/pdf": "pdf",
  };
  if (map[mime]) return map[mime];
  const sub = mime.split("/")[1] || fallback;
  return sub.split(";")[0];
}

// classifyMime + buildMediaAttachment are imported from _shared/media-attachment.ts
// so the persisted shape matches the web bot byte-for-byte.

async function uploadMediaToBucket(
  supabase: any, tenantId: string, bytes: Uint8Array, mime: string,
): Promise<string | null> {
  const ext = extOf(mime);
  const path = `${tenantId}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("service_media").upload(path, bytes, {
    contentType: mime || "application/octet-stream", upsert: false,
  });
  if (error) { console.error("[MEDIA] upload error", error); return null; }
  const { data } = supabase.storage.from("service_media").getPublicUrl(path);
  return data?.publicUrl || null;
}

async function attachMediaToActiveBooking(
  supabase: any, tenantId: string, phone: string, attachment: Record<string, unknown>,
) {
  const { data: booking } = await supabase
    .from("service_bookings")
    .select("id, media_attachments")
    .eq("tenant_id", tenantId).eq("phone_number", phone)
    .not("status", "in", "(cancelled,completed)")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!booking) return null;
  const list = Array.isArray(booking.media_attachments) ? booking.media_attachments : [];
  list.push(attachment);
  await supabase.from("service_bookings")
    .update({ media_attachments: list })
    .eq("id", booking.id);
  return booking.id;
}

async function fetchEvolutionMedia(
  cfg: Record<string, any>, msg: any,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const url = cfg?.evolution?.instance_url; const inst = cfg?.evolution?.instance_name; const key = cfg?.evolution?.api_key;
  if (!url || !inst || !key) return null;
  const mediaMsg = msg?.imageMessage || msg?.audioMessage || msg?.videoMessage || msg?.documentMessage;
  if (!mediaMsg) return null;
  const mime = mediaMsg.mimetype || (msg.imageMessage ? "image/jpeg" : msg.audioMessage ? "audio/ogg" : "application/octet-stream");
  try {
    const endpoint = `${url.replace(/\/+$/, "")}/chat/getBase64FromMediaMessage/${encodeURIComponent(inst)}`;
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { key: msg.key || {}, message: { ...msg } } }),
    });
    if (!resp.ok) { console.error("[MEDIA][EVO] fetch failed", resp.status, await resp.text().catch(() => "")); return null; }
    const j = await resp.json().catch(() => ({} as any));
    const b64: string | undefined = j?.base64 || j?.media || j?.data;
    if (!b64) return null;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  } catch (e) { console.error("[MEDIA][EVO] error", e); return null; }
}

async function fetchMetaMedia(
  accessToken: string, mediaId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const meta = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!meta.ok) return null;
    const j = await meta.json();
    if (!j?.url) return null;
    const file = await fetch(j.url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!file.ok) return null;
    const mime = j.mime_type || file.headers.get("content-type") || "application/octet-stream";
    const buf = await file.arrayBuffer();
    return { bytes: new Uint8Array(buf), mime };
  } catch (e) { console.error("[MEDIA][META] error", e); return null; }
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

        const evoMediaMsg = m.imageMessage || m.audioMessage || m.videoMessage || m.documentMessage || null;
        if (!messageText && !interactiveId && !evoMediaMsg) {
          return new Response(JSON.stringify({ success: true, skipped: "non_text" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Resolve tenant by Evolution instance_name in whatsapp_config
        const { data: tenantRow } = await supabase
          .from("tenants")
          .select("id, name, status, whatsapp_config, settings")
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
        // Stamp last_event_at on whatsapp_instances (Evolution-only mirror)
        await supabase.from("whatsapp_instances")
          .update({ last_event_at: new Date().toISOString(), status: "connected" })
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

        // Intercept CSAT button replies before any flow logic.
        const tenantWaCfg = (tenantRow.whatsapp_config as Record<string, any>) || {};
        const tenantSettings = (tenantRow.settings as Record<string, any>) || {};
        if (await handleCsatButton(supabase, tenantId, customerPhone, interactiveId, tenantWaCfg, tenantSettings, tenantRow.name || "")) {
          await supabase.from("chatbot_messages").insert({
            tenant_id: tenantId, conversation_id: conversationId, sender_type: "customer",
            content: messageText, message_type: "text",
            metadata: { gateway: "evolution", evo_message_id: key.id, interactive_id: interactiveId, kind: "csat_reply" },
          });
          return new Response(JSON.stringify({ success: true, gateway: "evolution", handled: "csat" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // Intercept service-estimate button replies before any flow logic.
        if (await handleEstimateButton(supabase, tenantId, customerPhone, interactiveId, tenantWaCfg)) {
          await supabase.from("chatbot_messages").insert({
            tenant_id: tenantId, conversation_id: conversationId, sender_type: "customer",
            content: messageText, message_type: "text",
            metadata: { gateway: "evolution", evo_message_id: key.id, interactive_id: interactiveId, kind: "estimate_reply" },
          });
          return new Response(JSON.stringify({ success: true, gateway: "evolution", handled: "estimate" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        // Intercept pre-appointment check-in button replies.
        if (await handleCheckinButton(supabase, tenantId, customerPhone, interactiveId, tenantWaCfg, tenantSettings)) {
          await supabase.from("chatbot_messages").insert({
            tenant_id: tenantId, conversation_id: conversationId, sender_type: "customer",
            content: messageText, message_type: "text",
            metadata: { gateway: "evolution", evo_message_id: key.id, interactive_id: interactiveId, kind: "checkin_reply" },
          });
          return new Response(JSON.stringify({ success: true, gateway: "evolution", handled: "checkin" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Handle inbound media (image / voice note / video / doc) — store + attach to active booking
        let evoAttachment: Record<string, unknown> | null = null;
        if (evoMediaMsg) {
          const media = await fetchEvolutionMedia(tenantWaCfg, m);
          if (media) {
            const publicUrl = await uploadMediaToBucket(supabase, tenantId, media.bytes, media.mime);
            if (publicUrl) {
              evoAttachment = buildMediaAttachment({
                url: publicUrl, mime: media.mime, source: "whatsapp_evolution",
              });
              const bookingId = await attachMediaToActiveBooking(supabase, tenantId, customerPhone, evoAttachment);
              (evoAttachment as any).booking_id = bookingId;
            }
          }
        }

        // Persist inbound message
        const evoMsgType = evoAttachment
          ? (evoAttachment.kind === "image" ? "image" : evoAttachment.kind === "audio" ? "audio" : "text")
          : "text";
        const { data: savedMessage } = await supabase.from("chatbot_messages")
          .insert({
            tenant_id: tenantId, conversation_id: conversationId, sender_type: "customer",
            content: messageText || (evoAttachment ? `[${evoAttachment.kind}] ${evoAttachment.url}` : ""),
            message_type: evoMsgType,
            metadata: { gateway: "evolution", evo_message_id: key.id, interactive_id: interactiveId, media: evoAttachment },
          })
          .select("id").single();

        // Intercept inbound text/media as a pre-appointment check-in follow-up.
        if (await handleCheckinFollowup(
          supabase, tenantId, customerPhone, messageText, !!evoAttachment, tenantWaCfg,
        )) {
          return new Response(JSON.stringify({ success: true, gateway: "evolution", handled: "checkin_followup" }), {
            status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Only run flow processor when there's a textual / interactive payload to act on.
        if (messageText || interactiveId) {
          await processChatbotFlow(
            supabase, tenantId, conversationId, savedMessage!.id,
            messageText, interactiveId, customerPhone, conversationMetadata, customerId,
          );
        }

        return new Response(JSON.stringify({ success: true, gateway: "evolution", media: evoAttachment?.kind || null }), {
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

              // Intercept CSAT, estimate, and pre-appointment check-in button replies before any flow logic.
              if (interactiveId && /^(csat_[1-5]|est_(approve|reject|call)|chk_(comments|photos|cancel|confirm_cancel|keep))_[0-9a-f-]{36}$/.test(interactiveId)) {
                const { data: tenantRow2 } = await supabase
                  .from("tenants").select("name, whatsapp_config, settings").eq("id", tenantId).maybeSingle();
                const wa2 = (tenantRow2?.whatsapp_config as Record<string, any>) || {};
                const settings2 = (tenantRow2?.settings as Record<string, any>) || {};
                const csatHandled = await handleCsatButton(
                  supabase, tenantId, customerPhone, interactiveId, wa2, settings2, tenantRow2?.name || "",
                );
                const estHandled = csatHandled ? false : await handleEstimateButton(
                  supabase, tenantId, customerPhone, interactiveId, wa2,
                );
                const chkHandled = (csatHandled || estHandled) ? false : await handleCheckinButton(
                  supabase, tenantId, customerPhone, interactiveId, wa2, settings2,
                );
                if (csatHandled || estHandled || chkHandled) {
                  await supabase.from("chatbot_messages").insert({
                    tenant_id: tenantId, conversation_id: conversationId, sender_type: "customer",
                    content: messageText, message_type: "text",
                    metadata: { wa_message_id: msg.id, interactive_id: interactiveId, kind: csatHandled ? "csat_reply" : estHandled ? "estimate_reply" : "checkin_reply" },
                  });
                  continue;
                }
              }


              // Handle inbound media (image/audio/video/document) for Meta Cloud API
              let metaAttachment: Record<string, unknown> | null = null;
              const metaMedia = (msg as any).image || (msg as any).audio || (msg as any).video || (msg as any).document;
              if (metaMedia?.id) {
                const { data: tenantCfg } = await supabase
                  .from("tenants").select("whatsapp_config").eq("id", tenantId).maybeSingle();
                const accessToken = (tenantCfg?.whatsapp_config as any)?.meta?.access_token
                  || (tenantCfg?.whatsapp_config as any)?.access_token;
                if (accessToken) {
                  const fetched = await fetchMetaMedia(accessToken, metaMedia.id);
                  if (fetched) {
                    const publicUrl = await uploadMediaToBucket(supabase, tenantId, fetched.bytes, fetched.mime);
                    if (publicUrl) {
                      metaAttachment = buildMediaAttachment({
                        url: publicUrl, mime: fetched.mime, source: "whatsapp_meta",
                      });
                      const bookingId = await attachMediaToActiveBooking(supabase, tenantId, customerPhone, metaAttachment);
                      (metaAttachment as any).booking_id = bookingId;
                    }
                  }
                }
              }

              const { data: savedMessage } = await supabase.from("chatbot_messages")
                .insert({
                  tenant_id: tenantId, conversation_id: conversationId, sender_type: "customer",
                  content: messageText || (metaAttachment ? `[${metaAttachment.kind}] ${metaAttachment.url}` : ""),
                  message_type: msg.type === "interactive" ? "text" : msg.type,
                  metadata: { wa_message_id: msg.id, wa_timestamp: msg.timestamp, interactive_id: interactiveId, referral: msg.referral || null, media: metaAttachment },
                })
                .select("id").single();

              // Intercept inbound text/media as a pre-appointment check-in follow-up.
              const { data: tenantWa2 } = await supabase
                .from("tenants").select("whatsapp_config").eq("id", tenantId).maybeSingle();
              const followupHandled = await handleCheckinFollowup(
                supabase, tenantId, customerPhone, messageText, !!metaAttachment,
                (tenantWa2?.whatsapp_config as Record<string, any>) || {},
              );
              if (followupHandled) continue;

              if (messageText || interactiveId) {
                await processChatbotFlow(
                  supabase, tenantId, conversationId, savedMessage!.id,
                  messageText, interactiveId, customerPhone, conversationMetadata, customerId
                );
              }
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
        const um = userMessage.toLowerCase();
        const match = node.options.find((o: any) => {
          if (o.value === interactiveId) return true;
          if (o.value && o.value.toLowerCase() === um) return true;
          // Match against the label in any supported language so users can reply
          // in their native language ("haan" / "نعم" / "yes") and still progress.
          const labels = typeof o.label === "string"
            ? [o.label]
            : SUPPORTED_LANGS.map((l) => o.label?.[l]).filter(Boolean);
          return labels.some((lbl: string) => lbl.toLowerCase() === um);
        });
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
    let replyText = pickLang(node.message, lang);
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
          title: (pickLang(o.label, lang) || "").substring(0, 20),
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

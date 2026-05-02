/**
 * End-to-end style tests for the WhatsApp webhook router.
 *
 * These tests do NOT require a live Supabase instance. They simulate
 * the routing/dispatch logic of `supabase/functions/whatsapp-webhook/index.ts`
 * against an in-memory mock Supabase client, then assert that:
 *
 *   1. Meta webhook payloads resolve the correct tenant via `phone_number_id`
 *      and complete a service-booking flow that writes to service_bookings
 *      AND tracks the conversation against the right tenant_id.
 *
 *   2. Evolution webhook payloads resolve the correct tenant via
 *      `whatsapp_config.evolution.instance_name` and complete the same
 *      flow, writing to service_bookings with booking_source =
 *      "whatsapp_evolution" — again under the correct tenant_id.
 *
 *   3. Cross-tenant isolation: a payload whose tenant resolver matches
 *      tenant A never produces inserts under tenant B.
 *
 * The router below is a faithful, minimal mirror of the dispatch + write
 * paths in the deployed edge function. If the edge function changes the
 * shape of those writes, update both in lockstep.
 */
import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// In-memory mock Supabase client (chainable, just enough for the router)
// ---------------------------------------------------------------------------
type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

function makeMockSupabase(initial: Tables) {
  const tables: Tables = JSON.parse(JSON.stringify(initial));
  for (const t of ["customers", "chatbot_conversations", "chatbot_messages",
    "chat_sessions", "service_bookings", "leads", "whatsapp_message_queue"]) {
    if (!tables[t]) tables[t] = [];
  }

  function from(table: string) {
    let rows = () => (tables[table] ||= []);
    const filters: Array<(r: Row) => boolean> = [];
    let pendingInsert: Row | Row[] | null = null;
    let pendingUpdate: Row | null = null;

    const api: any = {
      select: (_cols?: string) => api,
      eq: (col: string, val: any) => { filters.push((r) => r[col] === val); return api; },
      filter: (path: string, op: string, val: any) => {
        // Support "whatsapp_config->evolution->>instance_name" path
        const parts = path.split(/->>?|->/).map((p) => p.replace(/['"]/g, ""));
        filters.push((r) => {
          let cur = r;
          for (const p of parts) cur = cur?.[p];
          return op === "eq" ? cur === val : false;
        });
        return api;
      },
      order: (_c: string, _o?: any) => api,
      limit: (_n: number) => api,
      single: async () => {
        const found = rows().filter((r) => filters.every((f) => f(r)))[0];
        return { data: found ?? null, error: found ? null : { message: "not found" } };
      },
      maybeSingle: async () => {
        const found = rows().filter((r) => filters.every((f) => f(r)))[0];
        return { data: found ?? null, error: null };
      },
      insert: (payload: Row | Row[]) => { pendingInsert = payload; return api; },
      update: (payload: Row) => { pendingUpdate = payload; return api; },
      then: undefined, // not a thenable by default
    };

    // Make insert().select().single() actually persist + return
    const origSelect = api.select;
    api.select = (cols?: string) => {
      if (pendingInsert) {
        const arr = Array.isArray(pendingInsert) ? pendingInsert : [pendingInsert];
        for (const r of arr) {
          const withId = { id: r.id || `id-${table}-${rows().length + 1}`, ...r };
          rows().push(withId);
        }
        pendingInsert = null;
      }
      return origSelect(cols);
    };

    // Plain await on insert (no .select chain)
    api.insert = (payload: Row | Row[]) => {
      pendingInsert = payload;
      const arr = Array.isArray(payload) ? payload : [payload];
      for (const r of arr) {
        const withId = { id: r.id || `id-${table}-${rows().length + 1}`, ...r };
        rows().push(withId);
      }
      return {
        select: () => ({
          single: async () => ({ data: rows()[rows().length - 1], error: null }),
          maybeSingle: async () => ({ data: rows()[rows().length - 1], error: null }),
        }),
        then: (resolve: any) => resolve({ data: null, error: null }),
      };
    };

    // Plain await on update
    api.update = (payload: Row) => {
      pendingUpdate = payload;
      return {
        eq: (col: string, val: any) => {
          const matched = rows().filter((r) => r[col] === val);
          for (const r of matched) Object.assign(r, pendingUpdate);
          return Promise.resolve({ data: matched, error: null });
        },
      };
    };

    return api;
  }

  return { from, _tables: tables };
}

// ---------------------------------------------------------------------------
// Router under test — faithful mirror of the edge function entry dispatch
// (Meta vs Evolution detection, tenant resolution, conversation/customer
// upserts, and the "create_service_booking" terminal action.)
// ---------------------------------------------------------------------------
async function routeWebhook(supabase: any, body: any) {
  const evtName = (body.event || body.eventName || "").toString().toLowerCase().replace(/_/g, ".");
  const isEvolution =
    !!body.instance &&
    (evtName.includes("messages.upsert") || evtName.includes("message.upsert") || !!body.data?.key);

  // ---- EVOLUTION PATH ----
  if (isEvolution) {
    const instanceName = String(body.instance).trim();
    const data = body.data || {};
    const key = data.key || {};
    if (key.fromMe) return { skipped: "fromMe" };
    const remoteJid: string = key.remoteJid || "";
    if (!remoteJid || remoteJid.includes("@g.us")) return { skipped: "group_or_empty" };
    const customerPhone = remoteJid.split("@")[0].replace(/\D/g, "");
    const customerName = data.pushName || customerPhone;

    const { data: tenantRow } = await supabase
      .from("tenants").select("id, status, whatsapp_config")
      .eq("status", "active")
      .filter("whatsapp_config->evolution->>instance_name", "eq", instanceName)
      .maybeSingle();
    if (!tenantRow) return { skipped: "no_tenant" };
    const tenantId = tenantRow.id;

    return await runFlow(supabase, {
      tenantId, customerPhone, customerName, gateway: "evolution",
      messageText: data.message?.conversation || "",
    });
  }

  // ---- META PATH ----
  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  if (!value?.messages?.length) return { skipped: "no_message" };

  const phoneNumberId = value.metadata.phone_number_id;
  const { data: session } = await supabase
    .from("whatsapp_sessions").select("id, tenant_id")
    .eq("phone_number_id", phoneNumberId).eq("is_active", true).single();
  if (!session) return { skipped: "no_tenant" };
  const tenantId = session.tenant_id;

  const message = value.messages[0];
  const customerPhone = message.from;
  const customerName = value.contacts?.[0]?.profile?.name || customerPhone;
  const messageText = message.text?.body || "";

  return await runFlow(supabase, {
    tenantId, customerPhone, customerName, gateway: "meta", messageText,
  });
}

// Shared flow execution — mirrors the terminal "create_service_booking" path
// of the real flow processor. We trigger it whenever messageText contains
// "BOOK" so tests can drive it deterministically.
async function runFlow(
  supabase: any,
  ctx: { tenantId: string; customerPhone: string; customerName: string; gateway: "meta" | "evolution"; messageText: string },
) {
  // upsert customer
  let { data: customer } = await supabase
    .from("customers").select("id")
    .eq("tenant_id", ctx.tenantId).eq("phone", ctx.customerPhone).maybeSingle();
  if (!customer) {
    const ins = await supabase.from("customers").insert({
      tenant_id: ctx.tenantId, name: ctx.customerName, phone: ctx.customerPhone,
    }).select().single();
    customer = ins.data;
  }

  // upsert conversation
  let { data: convo } = await supabase
    .from("chatbot_conversations").select("id, metadata")
    .eq("tenant_id", ctx.tenantId).eq("phone_number", ctx.customerPhone)
    .eq("status", "active").maybeSingle();
  if (!convo) {
    const ins = await supabase.from("chatbot_conversations").insert({
      tenant_id: ctx.tenantId, customer_id: customer.id, channel: "whatsapp",
      phone_number: ctx.customerPhone, status: "active",
      metadata: { gateway: ctx.gateway },
    }).select().single();
    convo = ins.data;
  }

  // also track a chat_sessions row (mirrors public web chat + parity for WA)
  await supabase.from("chat_sessions").insert({
    tenant_id: ctx.tenantId, flow_id: "test-flow", visitor_token: ctx.customerPhone,
    language: "en", collected_data: { phone: ctx.customerPhone, gateway: ctx.gateway },
    is_complete: ctx.messageText.toUpperCase().includes("BOOK"),
  });

  // record inbound
  await supabase.from("chatbot_messages").insert({
    tenant_id: ctx.tenantId, conversation_id: convo.id,
    sender_type: "customer", content: ctx.messageText, message_type: "text",
    metadata: { gateway: ctx.gateway },
  });

  // terminal action: BOOK keyword triggers create_service_booking
  if (ctx.messageText.toUpperCase().includes("BOOK")) {
    const bookingSource = ctx.gateway === "evolution" ? "whatsapp_evolution" : "ai_bot";
    await supabase.from("service_bookings").insert({
      tenant_id: ctx.tenantId, customer_id: customer.id,
      customer_name: ctx.customerName, phone_number: ctx.customerPhone,
      vehicle_model: "Swift", service_type: "General Service",
      booking_date: "2026-05-10", pickup_required: false, drop_required: false,
      booking_source: bookingSource, status: "confirmed",
      metadata: { gateway: ctx.gateway },
    });
  }

  return { tenantId: ctx.tenantId, gateway: ctx.gateway, customerPhone: ctx.customerPhone };
}

// ---------------------------------------------------------------------------
// Test fixtures: two tenants — one Meta, one Evolution
// ---------------------------------------------------------------------------
const TENANT_META = "11111111-1111-1111-1111-111111111111";
const TENANT_EVO = "22222222-2222-2222-2222-222222222222";

function freshDb() {
  return makeMockSupabase({
    tenants: [
      { id: TENANT_META, status: "active", whatsapp_config: { provider: "meta", meta: { phone_number_id: "PHONE_META_1" } } },
      { id: TENANT_EVO, status: "active", whatsapp_config: { provider: "evolution", evolution: { instance_name: "dealer-evo-1", instance_url: "https://evo.example.com", api_key: "k" } } },
    ],
    whatsapp_sessions: [
      { id: "sess-1", tenant_id: TENANT_META, phone_number_id: "PHONE_META_1", is_active: true },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("WhatsApp webhook E2E — Meta payload", () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it("routes a Meta booking message to the correct tenant and creates a service_booking + chat_session", async () => {
    const metaPayload = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: "PHONE_META_1", display_phone_number: "+15550001" },
        contacts: [{ profile: { name: "Asha" }, wa_id: "919999900001" }],
        messages: [{ from: "919999900001", id: "wamid.META.1", type: "text", text: { body: "BOOK service please" } }],
      }}]}],
    };

    const out = await routeWebhook(db, metaPayload);

    expect(out.tenantId).toBe(TENANT_META);
    const bookings = db._tables.service_bookings;
    expect(bookings).toHaveLength(1);
    expect(bookings[0].tenant_id).toBe(TENANT_META);
    expect(bookings[0].phone_number).toBe("919999900001");
    expect(bookings[0].booking_source).toBe("ai_bot");
    expect(bookings[0].metadata.gateway).toBe("meta");

    const sessions = db._tables.chat_sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tenant_id).toBe(TENANT_META);
    expect(sessions[0].is_complete).toBe(true);
    expect(sessions[0].collected_data.gateway).toBe("meta");

    // No cross-tenant leakage
    expect(bookings.every((b) => b.tenant_id !== TENANT_EVO)).toBe(true);
    expect(sessions.every((s) => s.tenant_id !== TENANT_EVO)).toBe(true);
  });

  it("skips when phone_number_id has no matching tenant (no DB writes)", async () => {
    const out = await routeWebhook(db, {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: "UNKNOWN_PHONE_ID" },
        messages: [{ from: "1", type: "text", text: { body: "BOOK" } }],
      }}]}],
    });
    expect((out as any).skipped).toBe("no_tenant");
    expect(db._tables.service_bookings).toHaveLength(0);
    expect(db._tables.chat_sessions).toHaveLength(0);
  });
});

describe("WhatsApp webhook E2E — Evolution payload", () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });

  it("routes an Evolution booking message to the correct tenant by instance_name", async () => {
    const evoPayload = {
      event: "messages.upsert",
      instance: "dealer-evo-1",
      data: {
        key: { remoteJid: "919999900002@s.whatsapp.net", id: "EVO.1", fromMe: false },
        pushName: "Ravi",
        message: { conversation: "BOOK my service" },
      },
    };

    const out = await routeWebhook(db, evoPayload);

    expect(out.tenantId).toBe(TENANT_EVO);
    const bookings = db._tables.service_bookings;
    expect(bookings).toHaveLength(1);
    expect(bookings[0].tenant_id).toBe(TENANT_EVO);
    expect(bookings[0].phone_number).toBe("919999900002");
    expect(bookings[0].booking_source).toBe("whatsapp_evolution");
    expect(bookings[0].metadata.gateway).toBe("evolution");

    const sessions = db._tables.chat_sessions;
    expect(sessions[0].tenant_id).toBe(TENANT_EVO);
    expect(sessions[0].collected_data.gateway).toBe("evolution");

    // Strict tenant isolation
    expect(bookings.every((b) => b.tenant_id !== TENANT_META)).toBe(true);
    expect(sessions.every((s) => s.tenant_id !== TENANT_META)).toBe(true);
  });

  it("skips fromMe=true echoes and group messages without writing", async () => {
    await routeWebhook(db, {
      event: "messages.upsert", instance: "dealer-evo-1",
      data: { key: { remoteJid: "x@s.whatsapp.net", id: "1", fromMe: true } },
    });
    await routeWebhook(db, {
      event: "messages.upsert", instance: "dealer-evo-1",
      data: { key: { remoteJid: "1234-567@g.us", id: "2", fromMe: false }, message: { conversation: "BOOK" } },
    });
    expect(db._tables.service_bookings).toHaveLength(0);
    expect(db._tables.chat_sessions).toHaveLength(0);
  });

  it("skips when instance_name does not match any tenant", async () => {
    const out = await routeWebhook(db, {
      event: "messages.upsert", instance: "ghost-instance",
      data: { key: { remoteJid: "1@s.whatsapp.net" }, message: { conversation: "BOOK" } },
    });
    expect((out as any).skipped).toBe("no_tenant");
    expect(db._tables.service_bookings).toHaveLength(0);
  });
});

describe("WhatsApp webhook E2E — multi-tenant isolation", () => {
  it("two webhooks (one per gateway) produce two bookings each scoped to its own tenant", async () => {
    const db = freshDb();
    await routeWebhook(db, {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: "PHONE_META_1" },
        contacts: [{ profile: { name: "Meta User" } }],
        messages: [{ from: "111", type: "text", text: { body: "BOOK" } }],
      }}]}],
    });
    await routeWebhook(db, {
      event: "messages.upsert", instance: "dealer-evo-1",
      data: {
        key: { remoteJid: "222@s.whatsapp.net", id: "x", fromMe: false },
        pushName: "Evo User", message: { conversation: "BOOK" },
      },
    });

    const bookings = db._tables.service_bookings;
    expect(bookings).toHaveLength(2);
    const byTenant = Object.fromEntries(bookings.map((b) => [b.tenant_id, b]));
    expect(byTenant[TENANT_META].booking_source).toBe("ai_bot");
    expect(byTenant[TENANT_EVO].booking_source).toBe("whatsapp_evolution");
    expect(byTenant[TENANT_META].phone_number).toBe("111");
    expect(byTenant[TENANT_EVO].phone_number).toBe("222");
  });
});

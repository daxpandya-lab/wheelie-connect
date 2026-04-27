import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Car, Send, Loader2, Bot, User as UserIcon, Languages, CalendarIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { FlowData, FlowNode, ChatbotCollectedData } from "@/types/chatbot-flow";

interface DealerInfo {
  id: string;
  name: string;
}

interface ChatMessage {
  id: string;
  sender: "bot" | "user";
  text: string;
  options?: { label: string; value: string }[];
  multiSelect?: boolean;
  // For bot messages: keep raw node ref so we can re-render on language change
  nodeId?: string;
  data?: ChatbotCollectedData;
}

const VISITOR_KEY_PREFIX = "wheelie_chat_visitor_";
const SESSION_KEY_PREFIX = "wheelie_chat_session_";
const LANG_KEY_PREFIX = "wheelie_chat_lang_";

const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  hi: "हिन्दी",
  ar: "العربية",
};

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

async function logSessionDebug(params: {
  tenantId: string;
  flowId?: string | null;
  sessionId?: string | null;
  visitorToken?: string | null;
  event: string;
  reason?: string;
  nodeId?: string | null;
  details?: Record<string, unknown>;
}) {
  try {
    await supabase.from("session_debug" as never).insert({
      tenant_id: params.tenantId,
      flow_id: params.flowId ?? null,
      session_id: params.sessionId ?? null,
      visitor_token: params.visitorToken ?? null,
      event: params.event,
      reason: params.reason ?? null,
      node_id: params.nodeId ?? null,
      details: params.details ?? {},
      user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
    } as never);
  } catch {
    // Best-effort logging; never break chat UX on logging failure.
  }
}

function getVisitorToken(tenantId: string) {
  const key = VISITOR_KEY_PREFIX + tenantId;
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(key, token);
  }
  return token;
}

function detectBrowserLanguage(available: string[]): string {
  const candidates = (navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language || "en"]
  ).map((l) => l.toLowerCase());

  for (const c of candidates) {
    const base = c.split("-")[0];
    const match = available.find((a) => a.toLowerCase() === base);
    if (match) return match;
  }
  return available.includes("en") ? "en" : available[0];
}

function extractAvailableLanguages(flow: FlowData): string[] {
  const set = new Set<string>();
  for (const node of flow.nodes) {
    if (node.message) {
      Object.keys(node.message).forEach((k) => set.add(k));
    }
  }
  // Stable order: en, hi, ar first if present, then others
  const preferred = ["en", "hi", "ar"];
  const ordered = [
    ...preferred.filter((p) => set.has(p)),
    ...[...set].filter((l) => !preferred.includes(l)).sort(),
  ];
  return ordered.length ? ordered : ["en"];
}

export default function PublicChatPage() {
  const params = useParams<{ dealerId?: string; tenantSlug?: string; flowId?: string }>();
  const tenantParam = params.tenantSlug || params.dealerId; // backward-compat
  const flowIdParam = params.flowId;

  const [dealer, setDealer] = useState<DealerInfo | null>(null);
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [, setFlowId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [language, setLanguage] = useState<string>("en");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [collectedData, setCollectedData] = useState<ChatbotCollectedData>({});
  const [isComplete, setIsComplete] = useState(false);
  const [pendingMultiSelect, setPendingMultiSelect] = useState<Set<string>>(new Set());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [fuzzyEnabled, setFuzzyEnabled] = useState(true);
  const [fuzzyThreshold, setFuzzyThreshold] = useState(0.75);
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const availableLanguages = useMemo(
    () => (flow ? extractAvailableLanguages(flow) : ["en"]),
    [flow]
  );

  // ---------- Load dealer + active flow ----------
  useEffect(() => {
    if (!tenantParam) { setError("Invalid link"); setLoading(false); return; }

    (async () => {
      const { data: tenantData, error: tenantErr } = await supabase
        .from("tenants")
        .select("id, name, status, settings")
        .or(`id.eq.${tenantParam},slug.eq.${tenantParam}`)
        .maybeSingle();

      if (tenantErr || !tenantData) { setError("Dealer not found"); setLoading(false); return; }
      if (tenantData.status !== "active") { setError("This dealer is currently unavailable"); setLoading(false); return; }
      setDealer({ id: tenantData.id, name: tenantData.name });

      // Load per-dealer chatbot fuzzy-matching settings
      const tSettings = (tenantData.settings as Record<string, unknown>) || {};
      if (typeof tSettings.fuzzy_match_enabled === "boolean") {
        setFuzzyEnabled(tSettings.fuzzy_match_enabled);
      }
      if (typeof tSettings.fuzzy_match_threshold === "number") {
        setFuzzyThreshold(Math.min(1, Math.max(0.5, tSettings.fuzzy_match_threshold)));
      }

      let resolvedFlow: { id: string; flow_data: FlowData } | null = null;
      if (flowIdParam) {
        const { data } = await supabase
          .from("chatbot_flows")
          .select("id, flow_data, tenant_id")
          .eq("id", flowIdParam)
          .eq("tenant_id", tenantData.id)
          .maybeSingle();
        if (data) resolvedFlow = { id: data.id, flow_data: data.flow_data as unknown as FlowData };
      }
      if (!resolvedFlow) {
        const { data } = await supabase
          .from("chatbot_flows")
          .select("id, flow_data")
          .eq("tenant_id", tenantData.id)
          .eq("is_active", true)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data) resolvedFlow = { id: data.id, flow_data: data.flow_data as unknown as FlowData };
      }

      if (!resolvedFlow || !resolvedFlow.flow_data?.nodes?.length) {
        setError("No active chatbot flow available for this dealer");
        setLoading(false);
        return;
      }

      setFlow(resolvedFlow.flow_data);
      setFlowId(resolvedFlow.id);

      const flowLangs = extractAvailableLanguages(resolvedFlow.flow_data);

      // Resume or create session
      const visitorToken = getVisitorToken(tenantData.id);
      const sessionStorageKey = `${SESSION_KEY_PREFIX}${tenantData.id}_${resolvedFlow.id}`;
      const langStorageKey = `${LANG_KEY_PREFIX}${tenantData.id}_${resolvedFlow.id}`;
      const cached = localStorage.getItem(sessionStorageKey);
      let resumed = false;
      let resolvedLang: string =
        localStorage.getItem(langStorageKey) ||
        detectBrowserLanguage(flowLangs);
      if (!flowLangs.includes(resolvedLang)) resolvedLang = flowLangs[0];

      if (cached) {
        // Backend-aligned reset: only resume sessions that are NOT complete.
        // Filtering by is_complete=false at the query level guarantees that
        // any completed/archived session is treated as stale even if the
        // frontend cleanup was skipped (e.g. different device, cleared cache).
        const { data: existing, error: existingErr } = await supabase
          .from("chat_sessions")
          .select("id, current_node_id, collected_data, is_complete, language")
          .eq("id", cached)
          .eq("is_complete", false)
          .maybeSingle();
        if (existingErr) {
          // On any DB error, fail safe: drop pointer and start fresh from greeting.
          localStorage.removeItem(sessionStorageKey);
          logSessionDebug({
            tenantId: tenantData.id,
            flowId: resolvedFlow.id,
            sessionId: cached,
            visitorToken,
            event: "reset_db_error",
            reason: existingErr.message,
            details: { code: existingErr.code },
          });
        }
        if (existing) {
          const existingData = (existing.collected_data as ChatbotCollectedData) || {};
          const storedLang = (existing as { language?: string }).language;
          if (storedLang && flowLangs.includes(storedLang)) {
            resolvedLang = storedLang;
          }

          if (existing.is_complete) {
            // Previous session already finished — auto-start a fresh conversation
            // instead of stranding the user on the "complete, refresh to start over" screen.
            localStorage.removeItem(sessionStorageKey);
            logSessionDebug({
              tenantId: tenantData.id,
              flowId: resolvedFlow.id,
              sessionId: existing.id,
              visitorToken,
              event: "reset_completed",
              reason: "Previous session was already marked complete",
              nodeId: existing.current_node_id,
            });
          } else {
            const node = existing.current_node_id
              ? resolvedFlow.flow_data.nodes.find((n) => n.id === existing.current_node_id)
              : null;
            // Only resume on interactive question nodes; if the saved pointer
            // is on a background api_check / condition node, restart from the
            // greeting so users are never stuck on non-interactive logic nodes.
            const isInteractive =
              !!node && node.type !== "api_check" && node.type !== "condition";

            if (isInteractive && node) {
              setSessionId(existing.id);
              setCollectedData(existingData);
              setLanguage(resolvedLang);
              localStorage.setItem(langStorageKey, resolvedLang);
              setCurrentNodeId(node.id);
              pushBotMessage(node, existingData, resolvedLang);
              resumed = true;
              logSessionDebug({
                tenantId: tenantData.id,
                flowId: resolvedFlow.id,
                sessionId: existing.id,
                visitorToken,
                event: "resumed",
                nodeId: node.id,
                details: { nodeType: node.type, language: resolvedLang },
              });
            } else {
              // Stale / stuck session — clear pointer; fall through to create new session
              localStorage.removeItem(sessionStorageKey);
              logSessionDebug({
                tenantId: tenantData.id,
                flowId: resolvedFlow.id,
                sessionId: existing.id,
                visitorToken,
                event: "reset_background_node",
                reason: "Saved pointer was on a non-interactive node",
                nodeId: existing.current_node_id,
                details: { nodeType: node?.type ?? "unknown" },
              });
            }
          }
        } else if (!existingErr) {
          // Cached session id no longer exists in DB — clear it
          localStorage.removeItem(sessionStorageKey);
          logSessionDebug({
            tenantId: tenantData.id,
            flowId: resolvedFlow.id,
            sessionId: cached,
            visitorToken,
            event: "reset_missing",
            reason: "Cached session id not found (or already complete) in database",
          });
        }
      }

      if (!resumed) {
        setLanguage(resolvedLang);
        localStorage.setItem(langStorageKey, resolvedLang);

        const { data: newSession } = await supabase
          .from("chat_sessions")
          .insert({
            tenant_id: tenantData.id,
            flow_id: resolvedFlow.id,
            visitor_token: visitorToken,
            current_node_id: resolvedFlow.flow_data.startNodeId,
            collected_data: {},
            language: resolvedLang,
          } as never)
          .select("id")
          .single();
        if (newSession) {
          setSessionId(newSession.id);
          localStorage.setItem(sessionStorageKey, newSession.id);
          logSessionDebug({
            tenantId: tenantData.id,
            flowId: resolvedFlow.id,
            sessionId: newSession.id,
            visitorToken,
            event: "created",
            nodeId: resolvedFlow.flow_data.startNodeId,
            details: { language: resolvedLang, hadCachedPointer: !!cached },
          });
        }
        startFlow(resolvedFlow.flow_data, resolvedLang);
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantParam, flowIdParam]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ---------- Persist session updates ----------
  const persistSession = useCallback(
    async (patch: {
      current_node_id?: string | null;
      collected_data?: ChatbotCollectedData;
      is_complete?: boolean;
      language?: string;
    }) => {
      if (!sessionId) return;
      await supabase.from("chat_sessions").update(patch as never).eq("id", sessionId);
    },
    [sessionId]
  );

  // ---------- Flow execution ----------
  const interpolate = (text: string, data: ChatbotCollectedData) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(data[k] ?? `[${k}]`));

  const getNodeMessage = (node: FlowNode, data: ChatbotCollectedData, lang: string) => {
    const msg = node.message[lang] || node.message["en"] || Object.values(node.message)[0] || "";
    return interpolate(msg, data);
  };

  const pushBotMessage = (node: FlowNode, data: ChatbotCollectedData, lang: string) => {
    const text = getNodeMessage(node, data, lang);
    const options = node.options?.map((o) => ({ label: o.label, value: o.value }));
    setMessages((prev) => [
      ...prev,
      {
        id: `bot-${Date.now()}-${Math.random()}`,
        sender: "bot",
        text,
        options,
        multiSelect: node.multiSelect,
        nodeId: node.id,
        data,
      },
    ]);
    if (node.multiSelect) setPendingMultiSelect(new Set());
  };

  const validationErrorMessage = (kind: string, lang: string): string => {
    const msgs: Record<string, Record<string, string>> = {
      selection: {
        en: "⚠️ Please pick one of the options shown above.",
        hi: "⚠️ कृपया ऊपर दिखाए गए विकल्पों में से एक चुनें।",
        ar: "⚠️ يرجى اختيار أحد الخيارات المعروضة أعلاه.",
      },
      date: {
        en: "⚠️ Please choose a valid date using the date picker.",
        hi: "⚠️ कृपया डेट पिकर से एक वैध तारीख चुनें।",
        ar: "⚠️ يرجى اختيار تاريخ صالح باستخدام منتقي التاريخ.",
      },
      phone: {
        en: "⚠️ Please enter a valid phone number (7–15 digits).",
        hi: "⚠️ कृपया एक वैध फोन नंबर दर्ज करें (7–15 अंक)।",
        ar: "⚠️ يرجى إدخال رقم هاتف صالح (7–15 رقمًا).",
      },
      email: {
        en: "⚠️ Please enter a valid email address.",
        hi: "⚠️ कृपया एक वैध ईमेल पता दर्ज करें।",
        ar: "⚠️ يرجى إدخال عنوان بريد إلكتروني صالح.",
      },
      number: {
        en: "⚠️ Please enter a valid number.",
        hi: "⚠️ कृपया एक वैध संख्या दर्ज करें।",
        ar: "⚠️ يرجى إدخال رقم صالح.",
      },
      text: {
        en: "⚠️ Please type a valid answer.",
        hi: "⚠️ कृपया एक वैध उत्तर लिखें।",
        ar: "⚠️ يرجى كतابة إجابة صالحة.",
      },
      address: {
        en: "⚠️ Please enter a valid pickup/drop address (10–250 characters).",
        hi: "⚠️ कृपया एक वैध पिकअप/ड्रॉप पता दर्ज करें (10–250 वर्ण)।",
        ar: "⚠️ يرجى إدخال عنوان استلام/تسليم صالح (10–250 حرفًا).",
      },
    };
    return msgs[kind]?.[lang] || msgs[kind]?.en || msgs.text.en;
  };

  // ---------- Address validation + optional geocoding ----------
  const ADDRESS_MIN = 10;
  const ADDRESS_MAX = 250;
  const validateAddress = (raw: string): { ok: boolean; value: string } => {
    const v = (raw || "").trim().replace(/\s+/g, " ");
    if (v.length < ADDRESS_MIN || v.length > ADDRESS_MAX) return { ok: false, value: v };
    // Must contain at least some letters and digits/word chars (basic sanity)
    if (!/[A-Za-z\u0600-\u06FF\u0900-\u097F]/.test(v)) return { ok: false, value: v };
    return { ok: true, value: v };
  };

  // Normalize an address for dedupe: lowercase, strip diacritics, expand a few
  // common abbreviations (st./str./rd./ave./apt./bldg.), collapse punctuation
  // and whitespace. The output is stable across casing/punctuation/abbrev tweaks.
  const ADDRESS_ABBREV: Array<[RegExp, string]> = [
    [/\bst\.?\b/g, "street"],
    [/\bstr\.?\b/g, "street"],
    [/\brd\.?\b/g, "road"],
    [/\bave\.?\b/g, "avenue"],
    [/\bblvd\.?\b/g, "boulevard"],
    [/\bln\.?\b/g, "lane"],
    [/\bapt\.?\b/g, "apartment"],
    [/\bbldg\.?\b/g, "building"],
    [/\bfl\.?\b/g, "floor"],
    [/\bno\.?\b/g, "number"],
    [/\bnr\.?\b/g, "near"],
    [/\bopp\.?\b/g, "opposite"],
  ];
  const normalizeAddress = (raw: string): string => {
    const lowered = (raw || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");
    let out = lowered;
    for (const [re, rep] of ADDRESS_ABBREV) out = out.replace(re, rep);
    return out
      .replace(/[.,;:#\-_/\\()|]+/g, " ")
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  // Stable short hash (FNV-1a, hex) — used as the dedupe key in metadata.
  const addressHash = (normalized: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < normalized.length; i++) {
      h ^= normalized.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };

  // Look back through this tenant + phone's prior bookings; if the same
  // normalized address was used before, reuse the canonical (cleaned) form
  // and any geocoding result — saves a network call and keeps history consistent.
  const findCanonicalAddress = async (
    phone: string,
    normalized: string,
    hash: string
  ): Promise<{
    canonical: string;
    geo: { lat: number; lon: number; display_name: string } | null;
  } | null> => {
    if (!dealer || !phone || !normalized) return null;
    try {
      const { data: rows } = await supabase
        .from("service_bookings")
        .select("metadata")
        .eq("tenant_id", dealer.id)
        .eq("phone_number", phone)
        .order("created_at", { ascending: false })
        .limit(25);
      for (const row of rows || []) {
        const meta = (row as { metadata?: Record<string, unknown> }).metadata || {};
        const prior = String(meta.pickup_address_canonical || meta.pickup_address || "");
        if (!prior) continue;
        const priorHash = String(meta.pickup_address_hash || addressHash(normalizeAddress(prior)));
        if (priorHash === hash) {
          const lat = typeof meta.pickup_lat === "number" ? meta.pickup_lat : null;
          const lon = typeof meta.pickup_lon === "number" ? meta.pickup_lon : null;
          const display = typeof meta.pickup_resolved === "string" ? meta.pickup_resolved : "";
          return {
            canonical: prior,
            geo: lat != null && lon != null ? { lat, lon, display_name: display } : null,
          };
        }
      }
    } catch (e) {
      console.warn("Address dedupe lookup failed", e);
    }
    return null;
  };

  const geocodeAddress = async (
    addr: string
  ): Promise<{ lat: number; lon: number; display_name: string } | null> => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      const arr = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
      if (!Array.isArray(arr) || arr.length === 0) return null;
      const hit = arr[0];
      return { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), display_name: hit.display_name };
    } catch {
      return null;
    }
  };

  // ---------- Fuzzy matching for option typos ----------
  const normalizeForMatch = (s: string) =>
    s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

  const levenshtein = (a: string, b: string): number => {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const m = a.length, n = b.length;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      const curr = [i];
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      prev = curr;
    }
    return prev[n];
  };

  /** Returns the canonical option value if a fuzzy match is found, else null. */
  const fuzzyMatchOption = (
    raw: string,
    options: { label: string; value: string }[]
  ): string | null => {
    const q = normalizeForMatch(raw);
    if (!q) return null;
    let best: { value: string; score: number } | null = null;
    for (const o of options) {
      for (const candidate of [o.value, o.label]) {
        const c = normalizeForMatch(candidate);
        if (!c) continue;
        // Exact / contains shortcut (always allowed, even when fuzzy is disabled)
        if (c === q || c.includes(q) || q.includes(c)) {
          return o.value;
        }
        const dist = levenshtein(q, c);
        const maxLen = Math.max(q.length, c.length);
        const similarity = 1 - dist / maxLen;
        if (!best || similarity > best.score) best = { value: o.value, score: similarity };
      }
    }
    // If fuzzy matching is disabled, only exact/contains matches count (handled above).
    if (!fuzzyEnabled) return null;

    // Per-dealer configurable threshold (clamped 0.5–1.0).
    // Short-string forgiveness: when threshold ≤ 0.85, allow distance ≤ 2 for inputs of ≤6 chars.
    const t = Math.min(1, Math.max(0.5, fuzzyThreshold));
    if (best) {
      if (best.score >= t) return best.value;
      if (t <= 0.85 && q.length <= 6) {
        const dist = (1 - best.score) * Math.max(q.length, 1);
        if (dist <= 2) return best.value;
      }
    }
    return null;
  };

  /**
   * Validates the answer. Returns:
   *   - { ok: true, value } with the (possibly canonicalized) value
   *   - { ok: false, kind } with the error kind for re-prompt
   */
  const validateAnswer = (
    node: FlowNode,
    raw: string
  ): { ok: true; value: string } | { ok: false; kind: string } => {
    const value = raw.trim();
    if (node.options && node.options.length > 0) {
      const tokens = node.multiSelect
        ? value.split(",").map((t) => t.trim()).filter(Boolean)
        : [value];
      if (tokens.length === 0) return { ok: false, kind: "selection" };
      const canonical: string[] = [];
      for (const t of tokens) {
        const exact = node.options.find((o) => o.value === t || o.label === t);
        if (exact) {
          // For multi-select, store the human-readable label so downstream
          // consumers (service_bookings.service_type) get e.g. "Oil Change, Brake Service".
          canonical.push(node.multiSelect ? exact.label : exact.value);
          continue;
        }
        const fuzzy = fuzzyMatchOption(t, node.options);
        if (fuzzy) {
          const opt = node.options.find((o) => o.value === fuzzy);
          canonical.push(node.multiSelect && opt ? opt.label : fuzzy);
          continue;
        }
        return { ok: false, kind: "selection" };
      }
      return { ok: true, value: node.multiSelect ? canonical.join(", ") : canonical.join(",") };
    }
    // Address fields: required + length + character sanity (geocoding happens at submit)
    if (node.dataField && /address/i.test(node.dataField)) {
      const r = validateAddress(value);
      return r.ok ? { ok: true, value: r.value } : { ok: false, kind: "address" };
    }
    if (!value) return { ok: false, kind: node.validationType || "text" };
    switch (node.validationType) {
      case "date": {
        const iso = normalizeDate(value);
        return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !isNaN(new Date(iso).getTime())
          ? { ok: true, value: iso }
          : { ok: false, kind: "date" };
      }
      case "phone": {
        const digits = value.replace(/[^\d]/g, "");
        return digits.length >= 7 && digits.length <= 15
          ? { ok: true, value }
          : { ok: false, kind: "phone" };
      }
      case "email":
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
          ? { ok: true, value }
          : { ok: false, kind: "email" };
      case "number":
        return /^-?\d+(\.\d+)?$/.test(value)
          ? { ok: true, value }
          : { ok: false, kind: "number" };
      default:
        return { ok: true, value };
    }
  };

  const rejectAnswer = (node: FlowNode, kind: string) => {
    const errText = validationErrorMessage(kind, language);
    setMessages((prev) => [
      ...prev,
      { id: `bot-err-${Date.now()}`, sender: "bot", text: errText },
      // Re-show the current question so options/date picker remain the latest active bot message
      {
        id: `bot-reprompt-${Date.now()}`,
        sender: "bot",
        text: getNodeMessage(node, collectedData, language),
        options: node.options?.map((o) => ({ label: o.label, value: o.value })),
        multiSelect: node.multiSelect,
        nodeId: node.id,
        data: collectedData,
      },
    ]);
    if (node.multiSelect) setPendingMultiSelect(new Set());
  };

  const normalizeDate = (raw: string): string => {
    if (!raw) return raw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const m = raw.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return format(d, "yyyy-MM-dd");
    return raw;
  };

  const createBookingFromFlow = async (endNode: FlowNode, data: ChatbotCollectedData) => {
    if (!dealer) return;
    const action = (endNode.metadata?.action as string) || "";

    // Shared pickup/drop address pre-flight: required when pickup or drop is requested,
    // length-checked, and (best-effort) geocoded so coords are persisted in metadata.
    const needsAddress = !!data.pickup_required || !!data.drop_required;
    let geo: { lat: number; lon: number; display_name: string } | null = null;
    let addressClean = "";
    let addressNormalized = "";
    let addressHashKey = "";
    let addressDeduped = false;
    if (needsAddress) {
      const r = validateAddress(String(data.pickup_address || ""));
      if (!r.ok) {
        console.warn("Skipping booking insert: invalid pickup/drop address", data.pickup_address);
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-addr-${Date.now()}`,
            sender: "bot",
            text: validationErrorMessage("address", language),
          },
        ]);
        return;
      }
      addressClean = r.value;
      addressNormalized = normalizeAddress(addressClean);
      addressHashKey = addressHash(addressNormalized);

      // Dedupe: if this customer used the same normalized address before,
      // reuse the prior canonical form + geocoding result.
      const phone = String(data.phone_number || "");
      const prior = await findCanonicalAddress(phone, addressNormalized, addressHashKey);
      if (prior) {
        addressClean = prior.canonical;
        geo = prior.geo;
        addressDeduped = true;
      } else {
        geo = await geocodeAddress(addressClean);
      }
    }
    const addressMeta: Record<string, unknown> = needsAddress
      ? {
          pickup_address: addressClean,
          pickup_address_canonical: addressClean,
          pickup_address_normalized: addressNormalized,
          pickup_address_hash: addressHashKey,
          pickup_address_deduped: addressDeduped,
          pickup_address_geocoded: !!geo,
          ...(geo ? { pickup_lat: geo.lat, pickup_lon: geo.lon, pickup_resolved: geo.display_name } : {}),
        }
      : {};

    if (action === "create_service_booking") {
      const isoDate = normalizeDate(String(data.preferred_date || ""));
      if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        console.warn("Skipping service_booking insert: invalid date", data.preferred_date);
        return;
      }
      const vehicleParts = [data.vehicle_type, data.vehicle_model, data.registration_number]
        .filter(Boolean)
        .join(" • ");
      await supabase.from("service_bookings").insert({
        tenant_id: dealer.id,
        customer_name: String(data.customer_name || "Chatbot Visitor"),
        phone_number: String(data.phone_number || ""),
        vehicle_model: vehicleParts || String(data.vehicle_model || "Unknown"),
        kms_driven: typeof data.kms_driven === "number" ? data.kms_driven : null,
        service_type: String(data.service_type || ""),
        booking_date: isoDate,
        preferred_time: data.preferred_time ? String(data.preferred_time) : null,
        pickup_required: !!data.pickup_required,
        drop_required: !!data.drop_required,
        issue_description: data.issue_description ? String(data.issue_description) : null,
        notes: needsAddress ? `Pickup/Drop address: ${addressClean}` : null,
        booking_source: "chatbot",
        status: "pending",
        metadata: { ...data, ...addressMeta, source_session_id: sessionId },
      } as never);
    } else if (action === "create_test_drive_booking") {
      const isoDate = normalizeDate(String(data.preferred_date || ""));
      if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return;
      await supabase.from("test_drive_bookings").insert({
        tenant_id: dealer.id,
        customer_name: String(data.customer_name || "Chatbot Visitor"),
        phone_number: String(data.phone_number || ""),
        vehicle_model: String(data.vehicle_model || "Unknown"),
        preferred_date: isoDate,
        preferred_time: data.preferred_time ? String(data.preferred_time) : null,
        booking_source: "chatbot",
        status: "pending",
        metadata: { ...data, source_session_id: sessionId },
      } as never);
    } else if (action === "reschedule_service_booking") {
      const isoDate = normalizeDate(String(data.preferred_date || ""));
      const originalId = String(data._existing_booking_id || "");
      if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !originalId) {
        console.warn("Skipping reschedule: missing date or original booking id");
        return;
      }
      // 1) Cancel original booking, recording the link to the new one in metadata.
      await supabase
        .from("service_bookings")
        .update({
          status: "cancelled",
          metadata: {
            ...(data._existing_metadata as Record<string, unknown> || {}),
            rescheduled_at: new Date().toISOString(),
            rescheduled_via: "chatbot",
            rescheduled_session_id: sessionId,
          },
        } as never)
        .eq("id", originalId)
        .eq("tenant_id", dealer.id);

      // 2) Insert a fresh booking carrying over identity + service details.
      await supabase.from("service_bookings").insert({
        tenant_id: dealer.id,
        customer_name: String(data.existing_customer_name || data.customer_name || "Chatbot Visitor"),
        phone_number: String(data.phone_number || ""),
        vehicle_model: String(data.existing_vehicle_model || data.vehicle_model || "Unknown"),
        service_type: String(data.existing_service_type || data.service_type || ""),
        booking_date: isoDate,
        pickup_required: !!data.pickup_required,
        drop_required: !!data.drop_required,
        notes: needsAddress ? `Pickup/Drop address: ${addressClean}` : null,
        booking_source: "chatbot",
        status: "pending",
        metadata: {
          ...data,
          ...addressMeta,
          rescheduled_from: originalId,
          source_session_id: sessionId,
        },
      } as never);
    }
  };

  const advanceTo = useCallback(
    (nodeId: string, data: ChatbotCollectedData) => {
      if (!flow) return;
      const node = flow.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      setCurrentNodeId(node.id);
      pushBotMessage(node, data, language);
      persistSession({ current_node_id: node.id, collected_data: data });

      // Auto-execute non-interactive (background) nodes — never wait for user input
      if (node.type === "api_check") {
        // Trigger SQL availability check and auto-transition within ~700ms
        setTimeout(() => runApiCheck(node, data), 500);
      } else if (node.type === "condition") {
        // Route via first matching option (or default nextNodeId) without user input
        setTimeout(() => {
          let nextId: string | undefined = node.nextNodeId;
          if (node.options?.length) {
            const conditionField = (node.metadata?.field as string) || "";
            const currentVal = conditionField ? String(data[conditionField] ?? "") : "";
            const matched = node.options.find((o) => o.value === currentVal) || node.options[0];
            nextId = matched.nextNodeId || nextId;
          }
          if (nextId) advanceTo(nextId, data);
        }, 400);
      } else if (node.type === "greeting" && node.nextNodeId) {
        setTimeout(() => advanceTo(node.nextNodeId!, data), 700);
      } else if (node.type === "end") {
        const bookingId = `BK-${Date.now().toString(36).toUpperCase()}`;
        const finalData = { ...data, booking_id: bookingId };
        setCollectedData(finalData);
        // Persist booking to the appropriate table based on node metadata action
        createBookingFromFlow(node, finalData).catch((e) =>
          console.error("Failed to create booking record:", e)
        );
        setMessages((prev) =>
          prev.map((m) =>
            m.nodeId === node.id && m.sender === "bot"
              ? { ...m, text: interpolate(getNodeMessage(node, finalData, language), finalData), data: finalData }
              : m
          )
        );
        setIsComplete(true);
        persistSession({ current_node_id: node.id, collected_data: finalData, is_complete: true });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flow, language, persistSession]
  );

  // ---------- API check (slot availability) ----------
  const runApiCheck = async (node: FlowNode, data: ChatbotCollectedData) => {
    if (!flow || !dealer) return;
    const checkType = (node.metadata?.checkType as string) || "slot_availability";

    if (checkType === "slot_availability") {
      const date = String(data.preferred_date || "");
      let isoDate = date;
      const m = date.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
      if (m) isoDate = `${m[3]}-${m[2]}-${m[1]}`;

      setIsCheckingAvailability(true);
      const { data: result, error: rpcErr } = await supabase.rpc("check_booking_availability", {
        _tenant_id: dealer.id,
        _date: isoDate,
      });
      setIsCheckingAvailability(false);

      const available = !rpcErr && (result as { available?: boolean })?.available !== false;

      const condNode = node.nextNodeId ? flow.nodes.find((n) => n.id === node.nextNodeId) : null;
      let nextId: string | undefined;
      if (condNode && condNode.options?.length) {
        const matchVal = available ? "available" : "full";
        const matched = condNode.options.find((o) => o.value === matchVal);
        nextId = (matched || condNode.options[0]).nextNodeId;
      } else {
        nextId = node.nextNodeId;
      }

      if (!available) {
        const friendly =
          language === "hi"
            ? `क्षमा करें, हम ${date} के लिए पूरी तरह बुक हैं। कृपया कोई और तारीख चुनें।`
            : language === "ar"
            ? `عذرًا، نحن محجوزون بالكامل في ${date}. يرجى اختيار تاريخ آخر.`
            : `Sorry, we are fully booked for ${date}. Please select another date.`;
        setMessages((prev) => [
          ...prev,
          { id: `bot-${Date.now()}-full`, sender: "bot", text: friendly },
        ]);
      }

      if (nextId) setTimeout(() => advanceTo(nextId!, data), 500);
    } else if (checkType === "lookup_booking") {
      // Look up the most recent upcoming non-cancelled service booking for this phone.
      const phone = String(data.phone_number || "").trim();
      const today = format(new Date(), "yyyy-MM-dd");
      let lookupResult: "found" | "not_found" = "not_found";
      const newData: ChatbotCollectedData = { ...data };
      if (phone) {
        const { data: rows } = await supabase
          .from("service_bookings")
          .select("id, customer_name, vehicle_model, service_type, booking_date, pickup_required, drop_required, metadata")
          .eq("tenant_id", dealer.id)
          .eq("phone_number", phone)
          .neq("status", "cancelled")
          .gte("booking_date", today)
          .order("booking_date", { ascending: true })
          .limit(1);
        const row = rows?.[0];
        if (row) {
          lookupResult = "found";
          newData._existing_booking_id = row.id;
          newData._existing_metadata = row.metadata as Record<string, unknown>;
          newData.existing_customer_name = row.customer_name;
          newData.existing_vehicle_model = row.vehicle_model;
          newData.existing_service_type = row.service_type;
          newData.existing_booking_date = row.booking_date;
        }
      }
      newData._lookup_result = lookupResult;
      setCollectedData(newData);
      persistSession({ collected_data: newData });
      if (node.nextNodeId) setTimeout(() => advanceTo(node.nextNodeId!, newData), 400);
    } else if (checkType === "available_dates") {
      // Build the next 5 calendar days that have capacity, then rewrite the
      // next node's options so the user can pick one.
      const desiredCount = Math.max(1, Math.min(10, Number(node.metadata?.count) || 5));
      const found: { iso: string; label: string }[] = [];
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      // Skip "today" so the customer always reschedules to a future date.
      for (let i = 1; found.length < desiredCount && i <= 30; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const iso = format(d, "yyyy-MM-dd");
        const { data: result, error: rpcErr } = await supabase.rpc("check_booking_availability", {
          _tenant_id: dealer.id,
          _date: iso,
        });
        if (!rpcErr && (result as { available?: boolean })?.available !== false) {
          found.push({ iso, label: format(d, "EEE, dd MMM") });
        }
      }

      if (flow && node.nextNodeId) {
        const nextNode = flow.nodes.find((n) => n.id === node.nextNodeId);
        if (nextNode) {
          // Mutate next node's options in our flow state so the rendered
          // question shows the freshly-computed dates as buttons.
          const fallback = nextNode.options?.[0]?.nextNodeId || "";
          nextNode.options = found.length
            ? found.map((d) => ({ label: d.label, value: d.iso, nextNodeId: fallback }))
            : [{ label: "No dates available — try again later", value: "_none", nextNodeId: fallback }];
          setFlow({ ...flow });
        }
        setTimeout(() => advanceTo(node.nextNodeId!, data), 400);
      }
    } else if (node.nextNodeId) {
      setTimeout(() => advanceTo(node.nextNodeId!, data), 500);
    }
  };

  const startFlow = (f: FlowData, lang: string) => {
    const startNode = f.nodes.find((n) => n.id === f.startNodeId);
    if (!startNode) return;
    setCurrentNodeId(startNode.id);
    pushBotMessage(startNode, {}, lang);
    if (startNode.type === "greeting" && startNode.nextNodeId) {
      setTimeout(() => {
        const next = f.nodes.find((n) => n.id === startNode.nextNodeId);
        if (next) {
          setCurrentNodeId(next.id);
          pushBotMessage(next, {}, lang);
          persistSession({ current_node_id: next.id });
        }
      }, 700);
    }
  };

  const processAnswer = (answer: string, displayLabel?: string) => {
    if (!flow || !currentNodeId || isComplete) return;
    const currentNode = flow.nodes.find((n) => n.id === currentNodeId);
    if (!currentNode) return;

    // Per-node validation (with fuzzy matching for option typos)
    const result = validateAnswer(currentNode, answer);
    if (result.ok === false) {
      setMessages((prev) => [...prev, { id: `user-${Date.now()}`, sender: "user", text: displayLabel ?? answer }]);
      rejectAnswer(currentNode, result.kind);
      return;
    }
    // Use the canonicalized value (e.g. fuzzy-matched option value, normalized date)
    const canonical = result.value;

    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, sender: "user", text: displayLabel ?? answer }]);

    const newData = { ...collectedData };
    if (currentNode.dataField) {
      if (currentNode.validationType === "number") newData[currentNode.dataField] = parseInt(canonical) || 0;
      else if (currentNode.dataField === "pickup_required") {
        newData.pickup_required = canonical === "both" || canonical === "pickup";
        newData.drop_required = canonical === "both" || canonical === "drop";
      } else newData[currentNode.dataField] = canonical;
    }
    setCollectedData(newData);

    let nextNodeId: string | undefined;
    if (currentNode.options) {
      // For multi-select, route via the first selected value's nextNodeId (all options usually share next)
      const firstVal = currentNode.multiSelect ? canonical.split(",")[0]?.trim() : canonical;
      const selected = currentNode.options.find((o) => o.value === firstVal || o.label === firstVal);
      nextNodeId = selected?.nextNodeId || currentNode.nextNodeId;
    } else nextNodeId = currentNode.nextNodeId;

    if (!nextNodeId) return;
    setTimeout(() => advanceTo(nextNodeId!, newData), 500);
  };

  const submitMultiSelect = () => {
    if (!flow || !currentNodeId || pendingMultiSelect.size === 0) return;
    const node = flow.nodes.find((n) => n.id === currentNodeId);
    if (!node?.options) return;
    const selectedOpts = node.options.filter((o) => pendingMultiSelect.has(o.value));
    // Send labels joined by ", " so it stores as e.g. "Oil Change, Brake Service".
    const labelStr = selectedOpts.map((o) => o.label).join(", ");
    setPendingMultiSelect(new Set());
    processAnswer(labelStr, labelStr);
  };

  const toggleMultiSelectOption = (value: string) => {
    setPendingMultiSelect((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const handleSend = () => {
    if (!input.trim() || isComplete) return;
    processAnswer(input.trim());
    setInput("");
  };

  // ---------- Language change ----------
  const handleLanguageChange = (newLang: string) => {
    if (!flow || newLang === language) return;
    setLanguage(newLang);

    if (dealer) {
      const flowKey = Object.keys(localStorage).find((k) =>
        k.startsWith(`${LANG_KEY_PREFIX}${dealer.id}_`)
      );
      if (flowKey) localStorage.setItem(flowKey, newLang);
    }

    // Re-render previous bot messages in the new language
    setMessages((prev) =>
      prev.map((m) => {
        if (m.sender !== "bot" || !m.nodeId) return m;
        const node = flow.nodes.find((n) => n.id === m.nodeId);
        if (!node) return m;
        return {
          ...m,
          text: getNodeMessage(node, m.data || collectedData, newLang),
        };
      })
    );

    persistSession({ language: newLang });
  };

  // ---------- Render ----------
  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center space-y-2">
        <Car className="w-12 h-12 text-muted-foreground mx-auto" />
        <p className="text-lg font-medium text-foreground">{error}</p>
      </div>
    </div>
  );

  const isRtl = RTL_LANGUAGES.has(language);
  const currentNode = flow?.nodes.find((n) => n.id === currentNodeId) || null;
  const isDateNode =
    !!currentNode &&
    !isComplete &&
    (currentNode.type === "date_buttons" || currentNode.validationType === "date");
  const isSelectionNode =
    !!currentNode &&
    !isComplete &&
    !!currentNode.options &&
    currentNode.options.length > 0 &&
    currentNode.type !== "api_check" &&
    currentNode.type !== "condition";

  return (
    <div
      className="min-h-screen bg-background flex flex-col max-w-lg mx-auto"
      dir={isRtl ? "rtl" : "ltr"}
    >
      <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
          <Car className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm truncate">{dealer?.name}</p>
          <p className="text-xs opacity-75">Online</p>
        </div>
        {availableLanguages.length > 1 && (
          <Select value={language} onValueChange={handleLanguageChange}>
            <SelectTrigger
              className="h-8 w-auto gap-1 bg-primary-foreground/15 border-0 text-primary-foreground hover:bg-primary-foreground/25 focus:ring-0 focus:ring-offset-0"
              aria-label="Select language"
            >
              <Languages className="w-3.5 h-3.5" />
              <SelectValue>
                <span className="text-xs font-medium">
                  {LANGUAGE_LABELS[language] || language.toUpperCase()}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {availableLanguages.map((lang) => (
                <SelectItem key={lang} value={lang}>
                  {LANGUAGE_LABELS[lang] || lang.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg, idx) => {
          const isLast = idx === messages.length - 1;
          const isActiveOptions =
            isLast && !isComplete && msg.sender === "bot" && msg.nodeId === currentNodeId;
          return (
          <div key={msg.id} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
            <div className="flex items-start gap-2 max-w-[85%]">
              {msg.sender === "bot" && (
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
              )}
              <div>
                <div
                  className={`px-3 py-2 rounded-2xl text-sm whitespace-pre-line ${
                    msg.sender === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted text-foreground rounded-bl-md"
                  }`}
                >
                  {msg.text}
                </div>
                {msg.options && msg.sender === "bot" && msg.multiSelect && isActiveOptions && (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-col gap-1">
                      {msg.options.map((opt) => {
                        const checked = pendingMultiSelect.has(opt.value);
                        return (
                          <label
                            key={opt.value}
                            className={`flex items-center gap-2 px-3 py-2 text-xs rounded-lg border cursor-pointer transition-colors ${
                              checked
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border hover:bg-muted"
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => toggleMultiSelectOption(opt.value)}
                            />
                            <span>{opt.label}</span>
                          </label>
                        );
                      })}
                    </div>
                    {pendingMultiSelect.size > 0 && (
                      <Button
                        size="sm"
                        onClick={submitMultiSelect}
                        className="h-8 text-xs w-full"
                      >
                        Confirm Selection ({pendingMultiSelect.size})
                      </Button>
                    )}
                  </div>
                )}
                {msg.options && msg.sender === "bot" && !msg.multiSelect && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {msg.options.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => isActiveOptions && processAnswer(opt.value, opt.label)}
                        disabled={isComplete || !isActiveOptions}
                        className="px-3 py-1.5 text-xs rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {msg.sender === "user" && (
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5">
                  <UserIcon className="w-4 h-4 text-primary-foreground" />
                </div>
              )}
            </div>
          </div>
          );
        })}
        {isCheckingAvailability && (
          <div className="flex justify-start">
            <div className="flex items-start gap-2 max-w-[85%]">
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="px-3 py-2 rounded-2xl rounded-bl-md text-sm bg-muted text-foreground flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Checking availability…</span>
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t bg-background p-3 flex gap-2 shrink-0">
        {isDateNode ? (
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "flex-1 justify-start text-left font-normal",
                  !input && "text-muted-foreground"
                )}
                disabled={isComplete}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {input ? format(new Date(input), "dd-MM-yyyy") : "Pick a date (DD-MM-YYYY)"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={input ? new Date(input) : undefined}
                onSelect={(d) => {
                  if (!d) return;
                  const iso = format(d, "yyyy-MM-dd");
                  const display = format(d, "dd-MM-yyyy");
                  setInput(iso);
                  setDatePickerOpen(false);
                  // Submit immediately so the flow advances
                  processAnswer(iso, display);
                  setInput("");
                }}
                disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        ) : (
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isSelectionNode && handleSend()}
            placeholder={
              isComplete
                ? "Conversation complete"
                : isSelectionNode
                ? "Please choose an option above ☝️"
                : "Type your answer..."
            }
            className="flex-1"
            disabled={isComplete || isSelectionNode}
          />
        )}
        {!isDateNode && (
          <Button
            size="icon"
            onClick={handleSend}
            disabled={!input.trim() || isComplete || isSelectionNode}
          >
            <Send className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

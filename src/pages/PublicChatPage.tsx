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
        .select("id, name, status")
        .or(`id.eq.${tenantParam},slug.eq.${tenantParam}`)
        .maybeSingle();

      if (tenantErr || !tenantData) { setError("Dealer not found"); setLoading(false); return; }
      if (tenantData.status !== "active") { setError("This dealer is currently unavailable"); setLoading(false); return; }
      setDealer({ id: tenantData.id, name: tenantData.name });

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
        const { data: existing } = await supabase
          .from("chat_sessions")
          .select("id, current_node_id, collected_data, is_complete, language")
          .eq("id", cached)
          .maybeSingle();
        if (existing) {
          setSessionId(existing.id);
          const existingData = (existing.collected_data as ChatbotCollectedData) || {};
          setCollectedData(existingData);
          setIsComplete(existing.is_complete);
          // Prefer stored language if valid
          const storedLang = (existing as { language?: string }).language;
          if (storedLang && flowLangs.includes(storedLang)) {
            resolvedLang = storedLang;
          }
          setLanguage(resolvedLang);
          localStorage.setItem(langStorageKey, resolvedLang);

          if (existing.current_node_id) {
            const node = resolvedFlow.flow_data.nodes.find((n) => n.id === existing.current_node_id);
            if (node) {
              setCurrentNodeId(node.id);
              pushBotMessage(node, existingData, resolvedLang);
              resumed = true;
            }
          }
          if (existing.is_complete) {
            setMessages([{ id: "done", sender: "bot", text: "✅ Your previous session is complete. Refresh to start over." }]);
            resumed = true;
          }
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
        ar: "⚠️ يرجى كتابة إجابة صالحة.",
      },
    };
    return msgs[kind]?.[lang] || msgs[kind]?.en || msgs.text.en;
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
        // Exact / contains shortcut
        if (c === q || c.includes(q) || q.includes(c)) {
          return o.value;
        }
        const dist = levenshtein(q, c);
        const maxLen = Math.max(q.length, c.length);
        const similarity = 1 - dist / maxLen;
        if (!best || similarity > best.score) best = { value: o.value, score: similarity };
      }
    }
    // Threshold: 0.75 similarity, or distance ≤ 2 for short strings
    if (best && (best.score >= 0.75 || (q.length <= 6 && (1 - best.score) * Math.max(q.length, 1) <= 2))) {
      return best.value;
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
          canonical.push(exact.value);
          continue;
        }
        const fuzzy = fuzzyMatchOption(t, node.options);
        if (fuzzy) {
          canonical.push(fuzzy);
          continue;
        }
        return { ok: false, kind: "selection" };
      }
      return { ok: true, value: canonical.join(",") };
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
        booking_source: "chatbot",
        status: "pending",
        metadata: { ...data, source_session_id: sessionId },
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

      // Auto-execute non-interactive nodes (api_check / condition)
      if (node.type === "api_check") {
        setTimeout(() => runApiCheck(node, data), 600);
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
      // Try to parse various formats; rely on Postgres if ISO already
      let isoDate = date;
      const m = date.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/); // DD-MM-YYYY or DD/MM/YYYY
      if (m) isoDate = `${m[3]}-${m[2]}-${m[1]}`;

      const { data: result, error: rpcErr } = await supabase.rpc("check_booking_availability", {
        _tenant_id: dealer.id,
        _date: isoDate,
      });

      const available = !rpcErr && (result as { available?: boolean })?.available !== false;

      // Find condition successor based on outcome
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
        // Insert "fully booked" message before looping back
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

    // Per-node validation: reject and re-prompt if invalid
    const errKind = validateAnswer(currentNode, answer);
    if (errKind) {
      setMessages((prev) => [...prev, { id: `user-${Date.now()}`, sender: "user", text: displayLabel ?? answer }]);
      rejectAnswer(currentNode, errKind);
      return;
    }

    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, sender: "user", text: displayLabel ?? answer }]);

    const newData = { ...collectedData };
    if (currentNode.dataField) {
      if (currentNode.validationType === "number") newData[currentNode.dataField] = parseInt(answer) || 0;
      else if (currentNode.dataField === "pickup_required") {
        newData.pickup_required = answer === "both" || answer === "pickup";
        newData.drop_required = answer === "both" || answer === "drop";
      } else newData[currentNode.dataField] = answer;
    }
    setCollectedData(newData);

    let nextNodeId: string | undefined;
    if (currentNode.options) {
      // For multi-select, route via the first selected value's nextNodeId (all options usually share next)
      const firstVal = currentNode.multiSelect ? answer.split(",")[0]?.trim() : answer;
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
    const valueStr = selectedOpts.map((o) => o.value).join(",");
    const labelStr = selectedOpts.map((o) => o.label).join(", ");
    setPendingMultiSelect(new Set());
    processAnswer(valueStr, labelStr);
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
                  <div className="mt-2 space-y-1.5">
                    <div className="flex flex-col gap-1">
                      {msg.options.map((opt) => {
                        const checked = pendingMultiSelect.has(opt.value);
                        return (
                          <label
                            key={opt.value}
                            className={`flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border cursor-pointer transition-colors ${
                              checked
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border hover:bg-muted"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMultiSelectOption(opt.value)}
                              className="accent-primary"
                            />
                            <span>{opt.label}</span>
                          </label>
                        );
                      })}
                    </div>
                    <Button
                      size="sm"
                      onClick={submitMultiSelect}
                      disabled={pendingMultiSelect.size === 0}
                      className="h-7 text-xs"
                    >
                      Done ({pendingMultiSelect.size})
                    </Button>
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
                {input ? format(new Date(input), "PPP") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={input ? new Date(input) : undefined}
                onSelect={(d) => {
                  if (!d) return;
                  const iso = format(d, "yyyy-MM-dd");
                  const display = format(d, "PPP");
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

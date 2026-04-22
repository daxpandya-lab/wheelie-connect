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
import { Car, Send, Loader2, Bot, User as UserIcon, Languages } from "lucide-react";
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
        nodeId: node.id,
        data,
      },
    ]);
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

  const processAnswer = (answer: string) => {
    if (!flow || !currentNodeId || isComplete) return;
    const currentNode = flow.nodes.find((n) => n.id === currentNodeId);
    if (!currentNode) return;

    setMessages((prev) => [...prev, { id: `user-${Date.now()}`, sender: "user", text: answer }]);

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
      const selected = currentNode.options.find((o) => o.value === answer || o.label === answer);
      nextNodeId = selected?.nextNodeId || currentNode.nextNodeId;
    } else nextNodeId = currentNode.nextNodeId;

    if (currentNode.type === "api_check" || currentNode.type === "condition") {
      nextNodeId = currentNode.options?.[0]?.nextNodeId || currentNode.nextNodeId;
    }

    if (!nextNodeId) return;
    const nextNode = flow.nodes.find((n) => n.id === nextNodeId);
    if (!nextNode) return;

    setTimeout(() => {
      setCurrentNodeId(nextNode.id);
      if (nextNode.type === "end") {
        const finalData = { ...newData, booking_id: `BK-${Date.now().toString(36).toUpperCase()}` };
        setCollectedData(finalData);
        const text = interpolate(
          nextNode.message[language] || nextNode.message["en"] || "",
          finalData
        );
        setMessages((prev) => [
          ...prev,
          { id: `bot-${Date.now()}`, sender: "bot", text, nodeId: nextNode.id, data: finalData },
        ]);
        setIsComplete(true);
        persistSession({ current_node_id: nextNode.id, collected_data: finalData, is_complete: true });
      } else {
        pushBotMessage(nextNode, newData, language);
        persistSession({ current_node_id: nextNode.id, collected_data: newData });
      }
    }, 500);
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
        {messages.map((msg) => (
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
                {msg.options && msg.sender === "bot" && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {msg.options.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => processAnswer(opt.value)}
                        disabled={isComplete}
                        className="px-3 py-1.5 text-xs rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
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
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t bg-background p-3 flex gap-2 shrink-0">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={isComplete ? "Conversation complete" : "Type your answer..."}
          className="flex-1"
          disabled={isComplete}
        />
        <Button size="icon" onClick={handleSend} disabled={!input.trim() || isComplete}>
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

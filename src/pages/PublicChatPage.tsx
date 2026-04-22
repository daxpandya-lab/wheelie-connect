import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Car, Send, Loader2, Bot, User as UserIcon } from "lucide-react";
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
}

const VISITOR_KEY_PREFIX = "wheelie_chat_visitor_";
const SESSION_KEY_PREFIX = "wheelie_chat_session_";

function getVisitorToken(tenantId: string) {
  const key = VISITOR_KEY_PREFIX + tenantId;
  let token = localStorage.getItem(key);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(key, token);
  }
  return token;
}

export default function PublicChatPage() {
  const params = useParams<{ dealerId?: string; tenantSlug?: string; flowId?: string }>();
  const tenantParam = params.tenantSlug || params.dealerId; // backward-compat
  const flowIdParam = params.flowId;

  const [dealer, setDealer] = useState<DealerInfo | null>(null);
  const [flow, setFlow] = useState<FlowData | null>(null);
  const [flowId, setFlowId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [language] = useState("en");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [collectedData, setCollectedData] = useState<ChatbotCollectedData>({});
  const [isComplete, setIsComplete] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ---------- Load dealer + active flow ----------
  useEffect(() => {
    if (!tenantParam) { setError("Invalid link"); setLoading(false); return; }

    (async () => {
      // Resolve tenant by id or slug
      const { data: tenantData, error: tenantErr } = await supabase
        .from("tenants")
        .select("id, name, status")
        .or(`id.eq.${tenantParam},slug.eq.${tenantParam}`)
        .maybeSingle();

      if (tenantErr || !tenantData) { setError("Dealer not found"); setLoading(false); return; }
      if (tenantData.status !== "active") { setError("This dealer is currently unavailable"); setLoading(false); return; }
      setDealer({ id: tenantData.id, name: tenantData.name });

      // Resolve flow: requested id first, fall back to active
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

      // Resume or create session
      const visitorToken = getVisitorToken(tenantData.id);
      const sessionStorageKey = `${SESSION_KEY_PREFIX}${tenantData.id}_${resolvedFlow.id}`;
      const cached = localStorage.getItem(sessionStorageKey);
      let resumed = false;

      if (cached) {
        const { data: existing } = await supabase
          .from("chat_sessions")
          .select("id, current_node_id, collected_data, is_complete")
          .eq("id", cached)
          .maybeSingle();
        if (existing) {
          setSessionId(existing.id);
          setCollectedData((existing.collected_data as ChatbotCollectedData) || {});
          setIsComplete(existing.is_complete);
          if (existing.current_node_id) {
            const node = resolvedFlow.flow_data.nodes.find((n) => n.id === existing.current_node_id);
            if (node) {
              setCurrentNodeId(node.id);
              pushBotMessage(node, (existing.collected_data as ChatbotCollectedData) || {});
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
        const { data: newSession } = await supabase
          .from("chat_sessions")
          .insert({
            tenant_id: tenantData.id,
            flow_id: resolvedFlow.id,
            visitor_token: visitorToken,
            current_node_id: resolvedFlow.flow_data.startNodeId,
            collected_data: {},
          } as any)
          .select("id")
          .single();
        if (newSession) {
          setSessionId(newSession.id);
          localStorage.setItem(sessionStorageKey, newSession.id);
        }
        startFlow(resolvedFlow.flow_data);
      }

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantParam, flowIdParam]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ---------- Persist session updates ----------
  const persistSession = useCallback(
    async (patch: { current_node_id?: string | null; collected_data?: ChatbotCollectedData; is_complete?: boolean }) => {
      if (!sessionId) return;
      await supabase.from("chat_sessions").update(patch as any).eq("id", sessionId);
    },
    [sessionId]
  );

  // ---------- Flow execution (mirrors ChatPreview logic) ----------
  const interpolate = (text: string, data: ChatbotCollectedData) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, k) => String(data[k] ?? `[${k}]`));

  const getNodeMessage = (node: FlowNode, data: ChatbotCollectedData) => {
    const msg = node.message[language] || node.message["en"] || "";
    return interpolate(msg, data);
  };

  const pushBotMessage = (node: FlowNode, data: ChatbotCollectedData) => {
    const text = getNodeMessage(node, data);
    const options = node.options?.map((o) => ({ label: o.label, value: o.value }));
    setMessages((prev) => [...prev, { id: `bot-${Date.now()}-${Math.random()}`, sender: "bot", text, options }]);
  };

  const startFlow = (f: FlowData) => {
    const startNode = f.nodes.find((n) => n.id === f.startNodeId);
    if (!startNode) return;
    setCurrentNodeId(startNode.id);
    pushBotMessage(startNode, {});
    if (startNode.type === "greeting" && startNode.nextNodeId) {
      setTimeout(() => {
        const next = f.nodes.find((n) => n.id === startNode.nextNodeId);
        if (next) {
          setCurrentNodeId(next.id);
          pushBotMessage(next, {});
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
        const text = interpolate(nextNode.message[language] || nextNode.message["en"] || "", finalData);
        setMessages((prev) => [...prev, { id: `bot-${Date.now()}`, sender: "bot", text }]);
        setIsComplete(true);
        persistSession({ current_node_id: nextNode.id, collected_data: finalData, is_complete: true });
      } else {
        pushBotMessage(nextNode, newData);
        persistSession({ current_node_id: nextNode.id, collected_data: newData });
      }
    }, 500);
  };

  const handleSend = () => {
    if (!input.trim() || isComplete) return;
    processAnswer(input.trim());
    setInput("");
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

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-lg mx-auto">
      <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
          <Car className="w-5 h-5" />
        </div>
        <div>
          <p className="font-semibold text-sm">{dealer?.name}</p>
          <p className="text-xs opacity-75">Online</p>
        </div>
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

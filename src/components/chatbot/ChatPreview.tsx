import { useState, useRef, useEffect } from "react";
import type { FlowData, FlowNode, ChatbotCollectedData } from "@/types/chatbot-flow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, RotateCcw, Bot, User } from "lucide-react";

interface ChatMessage {
  id: string;
  sender: "bot" | "user";
  text: string;
  options?: { label: string; value: string }[];
  timestamp: Date;
}

interface ChatPreviewProps {
  flow: FlowData;
  language: string;
}

export default function ChatPreview({ flow, language }: ChatPreviewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [collectedData, setCollectedData] = useState<ChatbotCollectedData>({});
  const [isComplete, setIsComplete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const interpolate = (text: string, data: ChatbotCollectedData) => {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      return String(data[key] || `[${key}]`);
    });
  };

  const getNodeMessage = (node: FlowNode) => {
    const msg = node.message[language] || node.message["en"] || "";
    return interpolate(msg, collectedData);
  };

  const addBotMessage = (node: FlowNode) => {
    const text = getNodeMessage(node);
    const options = node.options?.map((o) => ({ label: o.label, value: o.value }));
    setMessages((prev) => [
      ...prev,
      { id: `bot-${Date.now()}`, sender: "bot", text, options, timestamp: new Date() },
    ]);
  };

  const startFlow = () => {
    setMessages([]);
    setCollectedData({});
    setIsComplete(false);
    const startNode = flow.nodes.find((n) => n.id === flow.startNodeId);
    if (startNode) {
      setCurrentNodeId(startNode.id);
      addBotMessage(startNode);
      // If greeting, auto-advance
      if (startNode.type === "greeting" && startNode.nextNodeId) {
        setTimeout(() => {
          const next = flow.nodes.find((n) => n.id === startNode.nextNodeId);
          if (next) {
            setCurrentNodeId(next.id);
            addBotMessage(next);
          }
        }, 800);
      }
    }
  };

  useEffect(() => { startFlow(); }, [flow, language]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const processAnswer = (answer: string) => {
    const currentNode = flow.nodes.find((n) => n.id === currentNodeId);
    if (!currentNode) return;

    // Add user message
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, sender: "user", text: answer, timestamp: new Date() },
    ]);

    // Store data
    const newData = { ...collectedData };
    if (currentNode.dataField) {
      if (currentNode.validationType === "number") {
        newData[currentNode.dataField] = parseInt(answer) || 0;
      } else if (currentNode.dataField === "pickup_required") {
        newData.pickup_required = answer === "both" || answer === "pickup";
        newData.drop_required = answer === "both" || answer === "drop";
      } else {
        newData[currentNode.dataField] = answer;
      }
    }
    setCollectedData(newData);

    // Find next node
    let nextNodeId: string | undefined;

    if (currentNode.options) {
      const selected = currentNode.options.find((o) => o.value === answer || o.label === answer);
      nextNodeId = selected?.nextNodeId || currentNode.nextNodeId;
    } else {
      nextNodeId = currentNode.nextNodeId;
    }

    // Handle special nodes
    if (currentNode.type === "api_check" || currentNode.type === "condition") {
      // Simulate slot check
      nextNodeId = currentNode.options?.[0]?.nextNodeId || currentNode.nextNodeId;
    }

    if (nextNodeId) {
      const nextNode = flow.nodes.find((n) => n.id === nextNodeId);
      if (nextNode) {
        setTimeout(() => {
          setCurrentNodeId(nextNode.id);
          if (nextNode.type === "api_check") {
            addBotMessage(nextNode);
            // Auto-advance through API check
            setTimeout(() => {
              const afterCheck = flow.nodes.find((n) => n.id === nextNode.nextNodeId);
              if (afterCheck) {
                setCurrentNodeId(afterCheck.id);
                // For condition, auto-pick first option (available)
                if (afterCheck.type === "condition" && afterCheck.options?.[0]) {
                  const resultNode = flow.nodes.find((n) => n.id === afterCheck.options![0].nextNodeId);
                  if (resultNode) {
                    setCurrentNodeId(resultNode.id);
                    addBotMessage(resultNode);
                  }
                } else {
                  addBotMessage(afterCheck);
                }
              }
            }, 1000);
          } else if (nextNode.type === "end") {
            const finalData = { ...newData, booking_id: `BK-${Date.now().toString(36).toUpperCase()}` };
            setCollectedData(finalData);
            const text = interpolate(
              nextNode.message[language] || nextNode.message["en"] || "",
              finalData
            );
            setMessages((prev) => [
              ...prev,
              { id: `bot-${Date.now()}`, sender: "bot", text, timestamp: new Date() },
            ]);
            setIsComplete(true);
          } else {
            addBotMessage(nextNode);
          }
        }, 600);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isComplete) return;
    processAnswer(input.trim());
    setInput("");
  };

  const handleOptionClick = (value: string) => {
    processAnswer(value);
  };

  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Chat Preview</span>
        </div>
        <Button variant="ghost" size="sm" onClick={startFlow} className="h-7 px-2">
          <RotateCcw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
            <div className="flex items-start gap-2 max-w-[85%]">
              {msg.sender === "bot" && (
                <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
              <div>
                <div
                  className={`px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
                    msg.sender === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                  }`}
                >
                  {msg.text}
                </div>
                {msg.options && msg.sender === "bot" && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {msg.options.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => handleOptionClick(opt.value)}
                        className="px-3 py-1.5 text-xs rounded-full border border-primary/30 text-primary hover:bg-primary/10 transition-colors"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {msg.sender === "user" && (
                <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-primary-foreground" />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Collected data summary */}
      {Object.keys(collectedData).length > 0 && (
        <div className="px-3 py-2 border-t border-border bg-muted/50">
          <p className="text-[10px] font-semibold text-muted-foreground mb-1">COLLECTED DATA</p>
          <div className="flex flex-wrap gap-1">
            {Object.entries(collectedData).filter(([, v]) => v !== undefined).map(([k, v]) => (
              <span key={k} className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                {k}: {String(v)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-border flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={isComplete ? "Flow complete" : "Type your answer..."}
          disabled={isComplete}
          className="h-9 text-sm"
        />
        <Button type="submit" size="sm" disabled={isComplete || !input.trim()} className="h-9 px-3">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Send, Bot, User, Search, MessageSquare, Loader2, Phone, Megaphone } from "lucide-react";

type Conversation = {
  id: string;
  phone_number: string | null;
  channel: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  customer_id: string | null;
  metadata: Record<string, unknown> | null;
};

type Message = {
  id: string;
  sender_type: string;
  content: string;
  message_type: string;
  sent_at: string;
  metadata: Record<string, unknown> | null;
};

type Customer = {
  id: string;
  name: string;
  phone: string | null;
};

export default function ConversationsPage() {
  const { tenantId } = useAuth();
  const [conversations, setConversations] = useState<(Conversation & { customer_name?: string })[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [reply, setReply] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async () => {
    if (!tenantId) return;
    const { data } = await supabase
      .from("chatbot_conversations")
      .select("id, phone_number, channel, status, started_at, ended_at, customer_id, metadata")
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false });

    if (data) {
      // Fetch customer names
      const customerIds = data.filter((c) => c.customer_id).map((c) => c.customer_id!);
      let customerMap: Record<string, string> = {};
      if (customerIds.length > 0) {
        const { data: customers } = await supabase
          .from("customers")
          .select("id, name")
          .in("id", customerIds);
        if (customers) {
          customerMap = Object.fromEntries(customers.map((c) => [c.id, c.name]));
        }
      }

      setConversations(
        data.map((c) => ({
          ...c,
          metadata: c.metadata as Record<string, unknown> | null,
          customer_name: c.customer_id ? customerMap[c.customer_id] : c.phone_number || "Unknown",
        }))
      );
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  // Real-time conversation updates
  useEffect(() => {
    if (!tenantId) return;
    const channel = supabase
      .channel("conversations_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "chatbot_conversations", filter: `tenant_id=eq.${tenantId}` }, () => fetchConversations())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tenantId, fetchConversations]);

  const fetchMessages = async (conversationId: string) => {
    setMsgLoading(true);
    setSelectedId(conversationId);

    const { data } = await supabase
      .from("chatbot_messages")
      .select("id, sender_type, content, message_type, sent_at, metadata")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true });

    if (data) setMessages(data.map((m) => ({ ...m, metadata: m.metadata as Record<string, unknown> | null })));
    setMsgLoading(false);
  };

  // Real-time messages
  useEffect(() => {
    if (!selectedId) return;
    const channel = supabase
      .channel(`messages_${selectedId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chatbot_messages", filter: `conversation_id=eq.${selectedId}` },
        (payload) => {
          const newMsg = payload.new as any;
          setMessages((prev) => [...prev, { ...newMsg, metadata: newMsg.metadata as Record<string, unknown> | null }]);
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSendReply = async () => {
    if (!reply.trim() || !selectedId || !tenantId) return;
    await supabase.from("chatbot_messages").insert({
      tenant_id: tenantId,
      conversation_id: selectedId,
      sender_type: "agent",
      content: reply.trim(),
      message_type: "text",
    });
    setReply("");
  };

  const filteredConversations = conversations.filter((c) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      (c.customer_name || "").toLowerCase().includes(s) ||
      (c.phone_number || "").includes(s)
    );
  });

  const selectedConvo = conversations.find((c) => c.id === selectedId);

  return (
    <>
      <TopBar title="Conversations" />
      <div className="flex-1 flex overflow-hidden">
        {/* Conversation List */}
        <div className="w-80 border-r border-border bg-card flex flex-col shrink-0">
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search conversations..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8 text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
            ) : filteredConversations.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">No conversations</div>
            ) : (
              filteredConversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => fetchMessages(c.id)}
                  className={cn(
                    "w-full flex items-start gap-3 p-3 text-left border-b border-border/50 transition-colors",
                    selectedId === c.id ? "bg-primary/5" : "hover:bg-secondary/50"
                  )}
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold shrink-0">
                    {(c.customer_name || "?")[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="font-medium text-foreground text-sm truncate">{c.customer_name}</p>
                      <Badge variant={c.status === "active" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0 shrink-0">
                        {c.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground truncate">{c.phone_number || "N/A"}</span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5 gap-1">
                      <span className="text-[10px] text-muted-foreground">{format(new Date(c.started_at), "MMM d, h:mm a")}</span>
                      {(c.metadata as any)?.ad_source && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded bg-accent/15 text-accent-foreground border border-accent/30">
                          <Megaphone className="w-2.5 h-2.5" />
                          FB Ad
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>Select a conversation to view messages</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="border-b border-border p-4 bg-card flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
                  {(selectedConvo?.customer_name || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-foreground text-sm">{selectedConvo?.customer_name}</p>
                    {(selectedConvo?.metadata as any)?.ad_source && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent-foreground border border-accent/30">
                        <Megaphone className="w-3 h-3" />
                        Source: FB Ad
                        {(selectedConvo?.metadata as any)?.ad_source?.source_ad_name && (
                          <span className="font-medium">— {(selectedConvo?.metadata as any).ad_source.source_ad_name}</span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="capitalize">{selectedConvo?.channel}</span>
                    <span>·</span>
                    <span>{selectedConvo?.phone_number}</span>
                  </div>
                </div>
                {/* Collected data preview */}
                {selectedConvo?.metadata?.collected_data && Object.keys(selectedConvo.metadata.collected_data as object).length > 0 && (
                  <div className="flex flex-wrap gap-1 max-w-xs">
                    {Object.entries(selectedConvo.metadata.collected_data as Record<string, unknown>)
                      .filter(([, v]) => v)
                      .slice(0, 4)
                      .map(([k, v]) => (
                        <span key={k} className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                          {k}: {String(v)}
                        </span>
                      ))}
                  </div>
                )}
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-secondary/20">
                {msgLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : messages.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">No messages yet</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={cn("flex", m.sender_type === "customer" ? "justify-start" : "justify-end")}>
                      <div className="flex items-start gap-2 max-w-[75%]">
                        {m.sender_type === "customer" && (
                          <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-1">
                            <User className="w-3.5 h-3.5 text-muted-foreground" />
                          </div>
                        )}
                        <div>
                          <div className={cn(
                            "rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap",
                            m.sender_type === "customer"
                              ? "bg-card text-foreground border border-border rounded-bl-sm"
                              : m.sender_type === "bot"
                              ? "bg-primary/10 text-foreground rounded-br-sm"
                              : "bg-primary text-primary-foreground rounded-br-sm"
                          )}>
                            <p>{m.content}</p>
                          </div>
                          <div className="flex items-center gap-1 mt-1">
                            {m.sender_type === "bot" && <Bot className="w-3 h-3 text-muted-foreground" />}
                            <span className="text-[10px] text-muted-foreground">
                              {format(new Date(m.sent_at), "h:mm a")} · {m.sender_type}
                            </span>
                          </div>
                        </div>
                        {m.sender_type !== "customer" && (
                          <div className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-1",
                            m.sender_type === "bot" ? "bg-primary/10" : "bg-primary"
                          )}>
                            {m.sender_type === "bot"
                              ? <Bot className="w-3.5 h-3.5 text-primary" />
                              : <User className="w-3.5 h-3.5 text-primary-foreground" />}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Reply Input */}
              <div className="border-t border-border p-3 bg-card flex gap-2">
                <Input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendReply()}
                  placeholder="Type a reply as agent..."
                  className="h-9 text-sm"
                />
                <Button size="sm" onClick={handleSendReply} disabled={!reply.trim()} className="h-9 px-3">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

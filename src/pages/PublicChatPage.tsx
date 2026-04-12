import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Car, Send, Loader2 } from "lucide-react";

interface DealerInfo {
  id: string;
  name: string;
  service_booking_enabled: boolean;
  test_drive_enabled: boolean;
}

interface Message {
  id: string;
  text: string;
  sender: "user" | "bot";
}

export default function PublicChatPage() {
  const { dealerId } = useParams<{ dealerId: string }>();
  const [dealer, setDealer] = useState<DealerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dealerId) { setError("Invalid link"); setLoading(false); return; }
    supabase.from("tenants").select("id, name, service_booking_enabled, test_drive_enabled, status")
      .eq("id", dealerId).single()
      .then(({ data, error: err }) => {
        if (err || !data) { setError("Dealer not found"); setLoading(false); return; }
        const d = data as any;
        if (d.status !== "active") { setError("This dealer is currently unavailable"); setLoading(false); return; }
        setDealer({ id: d.id, name: d.name, service_booking_enabled: d.service_booking_enabled ?? true, test_drive_enabled: d.test_drive_enabled ?? true });
        const modules: string[] = [];
        if (d.service_booking_enabled) modules.push("📋 Service Booking");
        if (d.test_drive_enabled) modules.push("🚗 Test Drive");
        setMessages([{
          id: "welcome",
          text: `Welcome to ${d.name}! How can I help you today?\n\nAvailable services:\n${modules.length > 0 ? modules.join("\n") : "No services available at this time."}`,
          sender: "bot",
        }]);
        setLoading(false);
      });
  }, [dealerId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg: Message = { id: Date.now().toString(), text: input, sender: "user" };
    setMessages(prev => [...prev, userMsg]);
    setInput("");

    const lower = input.toLowerCase();
    let reply = "Thanks for your message! A representative will get back to you shortly.";
    if (lower.includes("service") || lower.includes("booking")) {
      reply = dealer?.service_booking_enabled
        ? "We'd love to help with your service booking! Please share:\n• Vehicle Model\n• Preferred Date\n• Issue Description"
        : "Sorry, service bookings are currently not available.";
    } else if (lower.includes("test drive") || lower.includes("test")) {
      reply = dealer?.test_drive_enabled
        ? "Great choice! For a test drive, please share:\n• Interested Model\n• Preferred Date & Time\n• License Status (Verified/Pending)\n• Visit Type (Showroom/Home)"
        : "Sorry, test drives are currently not available.";
    }

    setTimeout(() => {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: reply, sender: "bot" }]);
    }, 800);
  };

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
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-full bg-primary-foreground/20 flex items-center justify-center">
          <Car className="w-5 h-5" />
        </div>
        <div>
          <p className="font-semibold text-sm">{dealer?.name}</p>
          <p className="text-xs opacity-75">Online</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line ${
              msg.sender === "user"
                ? "bg-primary text-primary-foreground rounded-br-md"
                : "bg-muted text-foreground rounded-bl-md"
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t bg-background p-3 flex gap-2 shrink-0">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message..."
          className="flex-1"
        />
        <Button size="icon" onClick={handleSend} disabled={!input.trim()}>
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

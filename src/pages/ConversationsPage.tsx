import TopBar from "@/components/TopBar";
import { cn } from "@/lib/utils";
import { Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const conversations = [
  { id: 1, name: "Ahmed Al-Farsi", lastMessage: "When can I pick up my car?", time: "2 min ago", unread: 2, channel: "whatsapp" },
  { id: 2, name: "Nadia Saleh", lastMessage: "I'd like to book a test drive", time: "15 min ago", unread: 0, channel: "whatsapp" },
  { id: 3, name: "Khalid Nasser", lastMessage: "What's the price for Land Cruiser?", time: "1h ago", unread: 1, channel: "web" },
  { id: 4, name: "Sara Khan", lastMessage: "Thank you for the service!", time: "3h ago", unread: 0, channel: "whatsapp" },
];

const messages = [
  { id: 1, sender: "customer", text: "Hi, I brought my Camry in this morning for a full service.", time: "9:15 AM" },
  { id: 2, sender: "agent", text: "Hello Ahmed! Yes, we have your 2023 Toyota Camry checked in. The service is currently in progress.", time: "9:20 AM" },
  { id: 3, sender: "customer", text: "Great! How long will it take?", time: "9:22 AM" },
  { id: 4, sender: "agent", text: "The full service typically takes about 3-4 hours. We estimate it'll be ready by 1:00 PM. We'll send you a notification when it's done.", time: "9:25 AM" },
  { id: 5, sender: "customer", text: "When can I pick up my car?", time: "12:45 PM" },
];

export default function ConversationsPage() {
  const [selected, setSelected] = useState(0);

  return (
    <>
      <TopBar title="Conversations" />
      <div className="flex-1 flex overflow-hidden">
        <div className="w-80 border-r border-border bg-card overflow-y-auto shrink-0">
          {conversations.map((c, i) => (
            <button
              key={c.id}
              onClick={() => setSelected(i)}
              className={cn(
                "w-full flex items-start gap-3 p-4 text-left border-b border-border/50 transition-colors",
                selected === i ? "bg-primary/5" : "hover:bg-secondary/50"
              )}
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold shrink-0">
                {c.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-foreground text-sm truncate">{c.name}</p>
                  <span className="text-xs text-muted-foreground shrink-0">{c.time}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate mt-0.5">{c.lastMessage}</p>
              </div>
              {c.unread > 0 && (
                <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center shrink-0">
                  {c.unread}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 flex flex-col">
          <div className="border-b border-border p-4 bg-card flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-semibold">
              {conversations[selected].name.split(" ").map(n => n[0]).join("")}
            </div>
            <div>
              <p className="font-medium text-foreground text-sm">{conversations[selected].name}</p>
              <p className="text-xs text-muted-foreground capitalize">{conversations[selected].channel}</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-secondary/20">
            {messages.map((m) => (
              <div key={m.id} className={cn("flex", m.sender === "agent" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[70%] rounded-2xl px-4 py-2.5 text-sm",
                  m.sender === "agent"
                    ? "bg-primary text-primary-foreground rounded-br-md"
                    : "bg-card text-foreground border border-border rounded-bl-md"
                )}>
                  <p>{m.text}</p>
                  <p className={cn("text-xs mt-1", m.sender === "agent" ? "text-primary-foreground/70" : "text-muted-foreground")}>{m.time}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border p-4 bg-card flex items-center gap-3">
            <input
              type="text"
              placeholder="Type a message..."
              className="flex-1 h-10 rounded-lg border border-input bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button size="icon"><Send className="w-4 h-4" /></Button>
          </div>
        </div>
      </div>
    </>
  );
}

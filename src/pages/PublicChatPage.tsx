import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Car, Send, Loader2, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

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
  showDatePicker?: boolean;
}

type FlowStep = "welcome" | "menu" | "service_name" | "service_phone" | "service_vehicle" | "service_date" | "service_issue" | "service_confirm"
  | "td_name" | "td_phone" | "td_model" | "td_date" | "td_license" | "td_visit" | "td_confirm";

interface CollectedData {
  customer_name?: string;
  phone_number?: string;
  vehicle_model?: string;
  preferred_date?: string;
  issue_description?: string;
  license_status?: string;
  visit_type?: string;
}

export default function PublicChatPage() {
  const { dealerId } = useParams<{ dealerId: string }>();
  const [dealer, setDealer] = useState<DealerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [step, setStep] = useState<FlowStep>("welcome");
  const [collected, setCollected] = useState<CollectedData>({});
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch dealer info and try to load active chatbot flow
  useEffect(() => {
    if (!dealerId) { setError("Invalid link"); setLoading(false); return; }

    const loadDealerAndFlow = async () => {
      // Fetch dealer
      const { data: tenantData, error: tenantErr } = await supabase
        .from("tenants")
        .select("id, name, service_booking_enabled, test_drive_enabled, status")
        .eq("id", dealerId)
        .single();

      if (tenantErr || !tenantData) { setError("Dealer not found"); setLoading(false); return; }
      const d = tenantData as any;
      if (d.status !== "active") { setError("This dealer is currently unavailable"); setLoading(false); return; }

      setDealer({
        id: d.id, name: d.name,
        service_booking_enabled: d.service_booking_enabled ?? true,
        test_drive_enabled: d.test_drive_enabled ?? true,
      });

      // Try to fetch active chatbot flow (for future use)
      await supabase
        .from("chatbot_flows")
        .select("id, flow_data")
        .eq("tenant_id", dealerId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      // Build welcome message
      const modules: string[] = [];
      if (d.service_booking_enabled) modules.push("1️⃣ Service Booking");
      if (d.test_drive_enabled) modules.push("2️⃣ Test Drive");

      setMessages([{
        id: "welcome",
        text: `Welcome to ${d.name}! 👋\n\nHow can I help you today?\n\n${modules.length > 0 ? modules.join("\n") : "No services available."}\n\nPlease reply with 1 or 2.`,
        sender: "bot",
      }]);
      setStep("menu");
      setLoading(false);
    };

    loadDealerAndFlow();
  }, [dealerId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const addBot = useCallback((text: string, showDatePicker = false) => {
    setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text, sender: "bot", showDatePicker }]);
  }, []);

  const addUser = useCallback((text: string) => {
    setMessages(prev => [...prev, { id: Date.now().toString(), text, sender: "user" }]);
  }, []);

  const saveServiceBooking = async (data: CollectedData): Promise<string | null> => {
    if (!dealerId) return "No dealer ID";
    setSaving(true);
    try {
      const payload = {
        tenant_id: dealerId,
        customer_name: data.customer_name || "Unknown",
        phone_number: data.phone_number || "",
        vehicle_model: data.vehicle_model || "",
        booking_date: data.preferred_date || new Date().toISOString().split("T")[0],
        service_type: "General Service",
        issue_description: data.issue_description || null,
        booking_source: "ai_bot",
      };
      const { error } = await supabase.from("service_bookings").insert(payload as any);
      setSaving(false);
      if (error) {
        console.error("Service booking save error:", error);
        return `Save failed: ${error.message}${error.details ? ` (${error.details})` : ""}`;
      }
      return null;
    } catch (e: any) {
      setSaving(false);
      return `Unexpected error: ${e.message}`;
    }
  };

  const saveTestDrive = async (data: CollectedData): Promise<string | null> => {
    if (!dealerId) return "No dealer ID";
    setSaving(true);
    try {
      const payload = {
        tenant_id: dealerId,
        customer_name: data.customer_name || "Unknown",
        phone_number: data.phone_number || "",
        vehicle_model: data.vehicle_model || "",
        preferred_date: data.preferred_date || new Date().toISOString().split("T")[0],
        booking_source: "ai_bot",
        notes: [
          data.license_status ? `License: ${data.license_status}` : null,
          data.visit_type ? `Visit: ${data.visit_type}` : null,
        ].filter(Boolean).join(" | ") || null,
      };
      const { error } = await supabase.from("test_drive_bookings").insert(payload as any);
      setSaving(false);
      if (error) {
        console.error("Test drive save error:", error);
        return `Save failed: ${error.message}${error.details ? ` (${error.details})` : ""}`;
      }
      return null;
    } catch (e: any) {
      setSaving(false);
      return `Unexpected error: ${e.message}`;
    }
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) return;
    setSelectedDate(date);
    setDatePopoverOpen(false);
    const formatted = format(date, "yyyy-MM-dd");
    addUser(format(date, "PPP"));
    setCollected(p => ({ ...p, preferred_date: formatted }));

    setTimeout(() => {
      if (step === "service_date") {
        addBot("Please describe the issue briefly:");
        setStep("service_issue");
      } else if (step === "td_date") {
        addBot("Is your driving license verified?\nReply: Verified or Pending");
        setStep("td_license");
      }
    }, 400);
  };

  const handleSend = async () => {
    if (!input.trim() || saving) return;
    const text = input.trim();
    addUser(text);
    setInput("");

    setTimeout(async () => {
      switch (step) {
        case "menu": {
          if (text === "1" && dealer?.service_booking_enabled) {
            addBot("Great! Let's book a service. 🔧\n\nWhat is your full name?");
            setStep("service_name");
          } else if (text === "2" && dealer?.test_drive_enabled) {
            addBot("Awesome! Let's schedule a test drive. 🚗\n\nWhat is your full name?");
            setStep("td_name");
          } else {
            addBot("Please reply with 1 for Service Booking or 2 for Test Drive.");
          }
          break;
        }
        case "service_name":
          setCollected(p => ({ ...p, customer_name: text }));
          addBot("Thanks! What's your phone number? 📱");
          setStep("service_phone");
          break;
        case "service_phone":
          setCollected(p => ({ ...p, phone_number: text }));
          addBot("What is your vehicle model? (e.g. 2024 Toyota Fortuner)");
          setStep("service_vehicle");
          break;
        case "service_vehicle":
          setCollected(p => ({ ...p, vehicle_model: text }));
          addBot("Please pick your preferred date 📅", true);
          setStep("service_date");
          break;
        case "service_date":
          // User typed a date manually instead of using picker
          setCollected(p => ({ ...p, preferred_date: text }));
          addBot("Please describe the issue briefly:");
          setStep("service_issue");
          break;
        case "service_issue": {
          const finalData = { ...collected, issue_description: text };
          setCollected(finalData);
          addBot(`Here's your booking summary:\n\n👤 ${finalData.customer_name}\n📱 ${finalData.phone_number}\n🚘 ${finalData.vehicle_model}\n📅 ${finalData.preferred_date}\n🔧 ${text}\n\nReply "yes" to confirm or "no" to cancel.`);
          setStep("service_confirm");
          break;
        }
        case "service_confirm": {
          if (text.toLowerCase().startsWith("y")) {
            const errMsg = await saveServiceBooking(collected);
            if (errMsg) addBot(`❌ ${errMsg}\n\nPlease try again or contact the dealer directly.`);
            else addBot("✅ Your service booking has been confirmed! We'll contact you shortly. Thank you!");
          } else {
            addBot("Booking cancelled. Type 1 or 2 to start again.");
          }
          setStep("menu");
          setCollected({});
          setSelectedDate(undefined);
          break;
        }
        case "td_name":
          setCollected(p => ({ ...p, customer_name: text }));
          addBot("What's your phone number? 📱");
          setStep("td_phone");
          break;
        case "td_phone":
          setCollected(p => ({ ...p, phone_number: text }));
          addBot("Which model are you interested in?");
          setStep("td_model");
          break;
        case "td_model":
          setCollected(p => ({ ...p, vehicle_model: text }));
          addBot("Please pick your preferred date 📅", true);
          setStep("td_date");
          break;
        case "td_date":
          setCollected(p => ({ ...p, preferred_date: text }));
          addBot("Is your driving license verified?\nReply: Verified or Pending");
          setStep("td_license");
          break;
        case "td_license":
          setCollected(p => ({ ...p, license_status: text }));
          addBot("Visit type?\nReply: Showroom or Home");
          setStep("td_visit");
          break;
        case "td_visit": {
          const finalTd = { ...collected, visit_type: text };
          setCollected(finalTd);
          addBot(`Test drive summary:\n\n👤 ${finalTd.customer_name}\n📱 ${finalTd.phone_number}\n🚘 ${finalTd.vehicle_model}\n📅 ${finalTd.preferred_date}\n🪪 ${finalTd.license_status}\n🏠 ${text}\n\nReply "yes" to confirm or "no" to cancel.`);
          setStep("td_confirm");
          break;
        }
        case "td_confirm": {
          if (text.toLowerCase().startsWith("y")) {
            const errMsg = await saveTestDrive(collected);
            if (errMsg) addBot(`❌ ${errMsg}\n\nPlease try again or contact the dealer directly.`);
            else addBot("✅ Your test drive has been scheduled! We'll reach out to confirm. Thank you!");
          } else {
            addBot("Cancelled. Type 1 or 2 to start again.");
          }
          setStep("menu");
          setCollected({});
          setSelectedDate(undefined);
          break;
        }
        default:
          addBot("Please reply with 1 or 2 to get started.");
      }
    }, 600);
  };

  const isDateStep = step === "service_date" || step === "td_date";

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
          <div key={msg.id}>
            <div className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-line ${
                msg.sender === "user"
                  ? "bg-primary text-primary-foreground rounded-br-md"
                  : "bg-muted text-foreground rounded-bl-md"
              }`}>
                {msg.text}
              </div>
            </div>
            {/* Inline date picker after bot message asking for date */}
            {msg.showDatePicker && isDateStep && (
              <div className="flex justify-start mt-2">
                <div className="bg-muted rounded-2xl rounded-bl-md p-2">
                  <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className={cn("w-full justify-start text-left font-normal", !selectedDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {selectedDate ? format(selectedDate, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={handleDateSelect}
                        disabled={(date) => date < new Date()}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            )}
          </div>
        ))}
        {saving && (
          <div className="flex justify-start">
            <div className="bg-muted text-foreground rounded-2xl rounded-bl-md px-4 py-2.5 text-sm">
              <Loader2 className="w-4 h-4 animate-spin inline mr-2" />Saving...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t bg-background p-3 flex gap-2 shrink-0">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder={isDateStep ? "Or type a date (YYYY-MM-DD)..." : "Type a message..."}
          className="flex-1"
          disabled={saving}
        />
        <Button size="icon" onClick={handleSend} disabled={!input.trim() || saving}>
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

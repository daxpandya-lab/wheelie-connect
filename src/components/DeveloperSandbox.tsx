import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Zap, Terminal, History } from "lucide-react";

type LogEntry = { ts: string; label: string; payload: unknown };
type Timeline = { ts: string; event: string; status: string };

/**
 * Isolated developer sandbox — purely in-memory simulation. Does not write to
 * production tables, does not dispatch WhatsApp messages, and does not invoke
 * live automation loops. Gated to the Master Super Admin ("Daxesh") upstream.
 */
export default function DeveloperSandbox() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [timeline, setTimeline] = useState<Timeline[]>([]);

  const pushLog = (label: string, payload: unknown) =>
    setLogs((prev) => [{ ts: new Date().toISOString(), label, payload }, ...prev].slice(0, 20));

  const simulateReminder = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const booking = {
      id: "sandbox-booking-0001",
      customer_name: "Test Customer",
      vehicle_model: "Test Cruiser",
      phone_number: "+9199999XXXXX",
      booking_date: tomorrow.toISOString().slice(0, 10),
      preferred_time: "10:00",
    };
    const mapsUrl = "https://maps.google.com/?q=Workshop+Location";
    const body =
      `Hi Test 👋\n\nThis is a friendly reminder about your service appointment tomorrow at ${booking.preferred_time} for your ${booking.vehicle_model}.\n\n` +
      `Need to make any changes? Just tap below:\n\n📍 Get Directions to Workshop: ${mapsUrl}`;
    const payload = {
      simulation: "pre_appointment_reminder",
      dry_run: true,
      booking,
      outbound: {
        kind: "buttons",
        text: body,
        buttons: [
          { id: `chk_comments_${booking.id}`, title: "📝 Add Comments" },
          { id: `chk_photos_${booking.id}`, title: "📸 Upload Photos" },
          { id: `chk_cancel_${booking.id}`, title: "❌ Cancel Appointment" },
        ],
        directions_url: mapsUrl,
      },
    };
    pushLog("⚡ Pre-Appointment Reminder (24h buffer)", payload);
  };

  const simulateDropoff = () => {
    const payload = {
      simulation: "chat_dropoff_recovery",
      dry_run: true,
      session: {
        id: "sandbox-session-0001",
        customer_name: "Test Customer",
        last_step: "vehicle_selection",
        idle_minutes: 32,
      },
      outbound: {
        kind: "text",
        text:
          "Hi Test 👋 Looks like our chat got cut off. Want to pick up where we left off and finish booking your service?",
      },
    };
    pushLog("⚡ Chat Drop-off Event", payload);
  };

  const simulateCancellation = () => {
    const bookingId = "sandbox-booking-0001";
    const nextStatus = "🔴 Canceled by Customer (Bot)";
    const payload = {
      simulation: "customer_cancellation_response",
      dry_run: true,
      inbound: { from: "+9199999XXXXX", button_id: `chk_cancel_${bookingId}` },
      state_transition: {
        booking_id: bookingId,
        previous_status: "confirmed",
        new_status: nextStatus,
        tenant_scoped: true,
      },
      audit: { actor: "whatsapp_bot", reason: "customer_button_reply" },
    };
    pushLog("⚡ Customer WhatsApp Cancellation", payload);
    setTimeline((prev) =>
      [
        {
          ts: new Date().toISOString(),
          event: `Booking ${bookingId} → ${nextStatus}`,
          status: nextStatus,
        },
        ...prev,
      ].slice(0, 10),
    );
  };

  return (
    <Card className="border-dashed border-warning/40 bg-warning/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          🛠️ Automation Logic Sandbox
          <Badge variant="outline" className="ml-2 text-[10px]">DEV · DRY-RUN</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          In-memory simulations only. No live messages, no production writes.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <Button variant="secondary" onClick={simulateReminder} className="justify-start">
            <Zap className="w-4 h-4 mr-2" /> Simulate Pre-Appointment Reminder (24h)
          </Button>
          <Button variant="secondary" onClick={simulateDropoff} className="justify-start">
            <Zap className="w-4 h-4 mr-2" /> Simulate Chat Drop-off Event
          </Button>
          <Button variant="secondary" onClick={simulateCancellation} className="justify-start">
            <Zap className="w-4 h-4 mr-2" /> Simulate Customer WhatsApp Cancellation
          </Button>
        </div>

        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-1">
            <Terminal className="w-3.5 h-3.5" /> Live Sandbox Payload Inspector
          </div>
          <pre className="rounded-md bg-zinc-950 text-emerald-300 text-[11px] leading-relaxed p-3 max-h-80 overflow-auto font-mono">
{logs.length === 0
  ? "// Awaiting simulation… click a button above to inject a mock payload."
  : logs
      .map(
        (l) =>
          `// ${l.ts}  ${l.label}\n${JSON.stringify(l.payload, null, 2)}`,
      )
      .join("\n\n")}
          </pre>
        </div>

        {timeline.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground mb-1">
              <History className="w-3.5 h-3.5" /> Mock History Timeline (cancellations)
            </div>
            <ul className="rounded-md border bg-card text-xs divide-y">
              {timeline.map((t, i) => (
                <li key={i} className="px-3 py-2 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-muted-foreground">{t.ts}</span>
                  <span>{t.event}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

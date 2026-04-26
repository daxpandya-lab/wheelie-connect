import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, BellRing } from "lucide-react";

interface Rule {
  id: string;
  tenant_id: string;
  booking_type: "service" | "test_drive";
  name: string;
  enabled: boolean;
  offset_days: number;
  anchor: "booking_date" | "created_at";
  send_time_of_day: string;
  template_name: string | null;
  message_body: string | null;
  stop_on_statuses: string[];
}

const STATUS_OPTIONS = [
  "pending",
  "confirmed",
  "in_progress",
  "completed",
  "cancelled",
];

function emptyRule(
  tenantId: string,
  bookingType: "service" | "test_drive",
): Rule {
  return {
    id: "new",
    tenant_id: tenantId,
    booking_type: bookingType,
    name:
      bookingType === "service"
        ? "Service reminder"
        : "Test drive reminder",
    enabled: true,
    offset_days: 1,
    anchor: "booking_date",
    send_time_of_day: "10:00:00",
    template_name: null,
    message_body:
      "Hi {{customer_name}}! Reminder about your {{vehicle_model}} appointment on {{booking_date}}.",
    stop_on_statuses: ["cancelled", "completed"],
  };
}

export default function ReminderSettings() {
  const { tenantId } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const { data, error } = await supabase
        .from("booking_reminder_rules")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("booking_type", { ascending: true })
        .order("offset_days", { ascending: true });
      if (error) toast.error(error.message);
      else setRules((data as Rule[]) ?? []);
      setLoading(false);
    })();
  }, [tenantId]);

  const update = (id: string, patch: Partial<Rule>) =>
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );

  const handleSave = async (rule: Rule) => {
    if (!tenantId) return;
    if (!rule.message_body && !rule.template_name) {
      toast.error("Provide a message body or a template name");
      return;
    }
    setSavingId(rule.id);
    const payload = {
      tenant_id: tenantId,
      booking_type: rule.booking_type,
      name: rule.name.trim() || "Reminder",
      enabled: rule.enabled,
      offset_days: rule.offset_days,
      anchor: rule.anchor,
      send_time_of_day: rule.send_time_of_day,
      template_name: rule.template_name?.trim() || null,
      message_body: rule.message_body?.trim() || null,
      stop_on_statuses: rule.stop_on_statuses,
    };

    if (rule.id === "new") {
      const { data, error } = await supabase
        .from("booking_reminder_rules")
        .insert(payload as never)
        .select("*")
        .single();
      if (error) toast.error(error.message);
      else {
        setRules((prev) =>
          prev.map((r) => (r.id === "new" ? (data as Rule) : r)),
        );
        toast.success("Reminder rule created");
      }
    } else {
      const { error } = await supabase
        .from("booking_reminder_rules")
        .update(payload as never)
        .eq("id", rule.id);
      if (error) toast.error(error.message);
      else toast.success("Reminder rule saved");
    }
    setSavingId(null);
  };

  const handleDelete = async (rule: Rule) => {
    if (rule.id === "new") {
      setRules((prev) => prev.filter((r) => r.id !== "new"));
      return;
    }
    const { error } = await supabase
      .from("booking_reminder_rules")
      .delete()
      .eq("id", rule.id);
    if (error) toast.error(error.message);
    else {
      setRules((prev) => prev.filter((r) => r.id !== rule.id));
      toast.success("Reminder rule removed");
    }
  };

  const addRule = (bookingType: "service" | "test_drive") => {
    if (!tenantId) return;
    if (rules.some((r) => r.id === "new")) {
      toast.error("Save the new rule first");
      return;
    }
    setRules((prev) => [...prev, emptyRule(tenantId, bookingType)]);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  const sections: { key: "service" | "test_drive"; title: string }[] = [
    { key: "service", title: "Service bookings" },
    { key: "test_drive", title: "Test drive bookings" },
  ];

  return (
    <div className="space-y-8">
      <div className="glass-card rounded-xl p-5 flex items-start gap-3">
        <BellRing className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Automated WhatsApp follow-ups
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Add as many reminders as you like for each booking type. They are
            scheduled relative to the booking and dispatched every 5 minutes.
            Variables you can use in the message:{" "}
            <code className="text-xs">{"{{customer_name}}"}</code>,{" "}
            <code className="text-xs">{"{{vehicle_model}}"}</code>,{" "}
            <code className="text-xs">{"{{booking_date}}"}</code>.
          </p>
        </div>
      </div>

      {sections.map((sec) => {
        const list = rules.filter((r) => r.booking_type === sec.key);
        return (
          <div key={sec.key} className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-foreground">
                {sec.title}
              </h4>
              <Button
                size="sm"
                variant="outline"
                onClick={() => addRule(sec.key)}
              >
                <Plus className="w-4 h-4 mr-1" /> Add reminder
              </Button>
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No reminders configured.
              </p>
            ) : (
              list.map((rule) => (
                <div
                  key={rule.id}
                  className="glass-card rounded-xl p-5 space-y-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <Input
                      value={rule.name}
                      onChange={(e) =>
                        update(rule.id, { name: e.target.value })
                      }
                      className="max-w-xs"
                      placeholder="Reminder name"
                    />
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`enabled-${rule.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        Enabled
                      </Label>
                      <Switch
                        id={`enabled-${rule.id}`}
                        checked={rule.enabled}
                        onCheckedChange={(v) =>
                          update(rule.id, { enabled: v })
                        }
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Offset (days)</Label>
                      <Input
                        type="number"
                        value={rule.offset_days}
                        onChange={(e) =>
                          update(rule.id, {
                            offset_days: parseInt(e.target.value || "0", 10),
                          })
                        }
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Negative = before, positive = after
                      </p>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Anchor</Label>
                      <Select
                        value={rule.anchor}
                        onValueChange={(v) =>
                          update(rule.id, {
                            anchor: v as Rule["anchor"],
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="booking_date">
                            Booking date
                          </SelectItem>
                          <SelectItem value="created_at">
                            Booking created
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Send time (UTC)</Label>
                      <Input
                        type="time"
                        value={rule.send_time_of_day.slice(0, 5)}
                        onChange={(e) =>
                          update(rule.id, {
                            send_time_of_day: `${e.target.value}:00`,
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Message body</Label>
                    <Textarea
                      rows={3}
                      value={rule.message_body ?? ""}
                      onChange={(e) =>
                        update(rule.id, { message_body: e.target.value })
                      }
                      placeholder="Hi {{customer_name}}, …"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">
                      WhatsApp template name (optional)
                    </Label>
                    <Input
                      value={rule.template_name ?? ""}
                      onChange={(e) =>
                        update(rule.id, {
                          template_name: e.target.value,
                        })
                      }
                      placeholder="Leave blank to send free-text message"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">
                      Stop sending if booking status becomes
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {STATUS_OPTIONS.map((s) => {
                        const active = rule.stop_on_statuses.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() =>
                              update(rule.id, {
                                stop_on_statuses: active
                                  ? rule.stop_on_statuses.filter(
                                      (x) => x !== s,
                                    )
                                  : [...rule.stop_on_statuses, s],
                              })
                            }
                            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                              active
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border/40">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(rule)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleSave(rule)}
                      disabled={savingId === rule.id}
                    >
                      {savingId === rule.id ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

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
import { Plus, Trash2, BellRing, Eye } from "lucide-react";

function renderTemplate(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

interface PreviewVars {
  customer_name: string;
  vehicle_model: string;
  booking_date: string;
}

const DEFAULT_PREVIEW: PreviewVars = {
  customer_name: "Rahul Sharma",
  vehicle_model: "Honda City",
  booking_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
};

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

interface PredictiveCfg {
  enabled: boolean;
  interval_months: number;
}

export default function ReminderSettings() {
  const { tenantId } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [predictive, setPredictive] = useState<PredictiveCfg>({ enabled: true, interval_months: 6 });
  const [savingPredictive, setSavingPredictive] = useState(false);
  const [previewOpen, setPreviewOpen] = useState<Record<string, boolean>>({});
  const [previewVars, setPreviewVars] = useState<Record<string, PreviewVars>>({});
  const [previewResult, setPreviewResult] = useState<
    Record<string, { mode: "text" | "template"; body: string | null; note?: string; error?: string; loading?: boolean }>
  >({});

  const getVars = (id: string): PreviewVars => previewVars[id] ?? DEFAULT_PREVIEW;
  const setVars = (id: string, patch: Partial<PreviewVars>) =>
    setPreviewVars((p) => ({ ...p, [id]: { ...getVars(id), ...patch } }));

  // Debounced server-side render of any open preview so it always matches the dispatcher.
  useEffect(() => {
    const openIds = Object.keys(previewOpen).filter((id) => previewOpen[id]);
    if (openIds.length === 0) return;
    const handles = openIds.map((id) => {
      const rule = rules.find((r) => r.id === id);
      if (!rule) return null;
      const t = setTimeout(async () => {
        setPreviewResult((p) => ({ ...p, [id]: { ...(p[id] ?? { mode: "text", body: null }), loading: true } }));
        const { data, error } = await supabase.functions.invoke("preview-reminder-message", {
          body: {
            message_body: rule.message_body,
            template_name: rule.template_name,
            variables: getVars(id),
          },
        });
        if (error) {
          setPreviewResult((p) => ({ ...p, [id]: { mode: "text", body: null, error: error.message, loading: false } }));
        } else {
          setPreviewResult((p) => ({
            ...p,
            [id]: {
              mode: data?.mode ?? "text",
              body: data?.rendered_body ?? null,
              note: data?.note,
              loading: false,
            },
          }));
        }
      }, 250);
      return t;
    });
    return () => handles.forEach((h) => h && clearTimeout(h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen, previewVars, rules]);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      const [{ data: rulesData, error }, { data: tenant }] = await Promise.all([
        supabase
          .from("booking_reminder_rules")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("booking_type", { ascending: true })
          .order("offset_days", { ascending: true }),
        supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle(),
      ]);
      if (error) toast.error(error.message);
      else setRules((rulesData as Rule[]) ?? []);
      const cfg = (tenant?.settings as Record<string, unknown> | null)?.predictive_service_reminder as
        | Partial<PredictiveCfg>
        | undefined;
      setPredictive({
        enabled: cfg?.enabled !== false,
        interval_months: Math.min(36, Math.max(1, Number(cfg?.interval_months ?? 6) || 6)),
      });
      setLoading(false);
    })();
  }, [tenantId]);

  const savePredictive = async () => {
    if (!tenantId) return;
    setSavingPredictive(true);
    const { data: tenant } = await supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
    const settings = { ...((tenant?.settings as Record<string, unknown>) || {}), predictive_service_reminder: predictive };
    const { error } = await supabase.from("tenants").update({ settings } as never).eq("id", tenantId);
    if (error) toast.error(error.message);
    else toast.success("Predictive reminder settings saved");
    setSavingPredictive(false);
  };

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

      <div className="glass-card rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Predictive service reminder</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Nudge customers a configurable number of months after their last completed service.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="predictive-enabled" className="text-xs text-muted-foreground">Enabled</Label>
            <Switch
              id="predictive-enabled"
              checked={predictive.enabled}
              onCheckedChange={(v) => setPredictive((p) => ({ ...p, enabled: v }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Interval (months)</Label>
            <Input
              type="number"
              min={1}
              max={36}
              value={predictive.interval_months}
              onChange={(e) =>
                setPredictive((p) => ({
                  ...p,
                  interval_months: Math.min(36, Math.max(1, parseInt(e.target.value || "6", 10) || 6)),
                }))
              }
            />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button size="sm" onClick={savePredictive} disabled={savingPredictive}>
              {savingPredictive ? "Saving..." : "Save"}
            </Button>
          </div>
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

                  <div className="space-y-2 pt-2 border-t border-border/40">
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewOpen((p) => ({ ...p, [rule.id]: !p[rule.id] }))
                      }
                      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {previewOpen[rule.id] ? "Hide preview" : "Preview message"}
                    </button>
                    {previewOpen[rule.id] && (
                      <div className="rounded-lg border border-border/60 bg-muted/30 p-3 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">Customer name</Label>
                            <Input
                              value={getVars(rule.id).customer_name}
                              onChange={(e) => setVars(rule.id, { customer_name: e.target.value })}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">Vehicle model</Label>
                            <Input
                              value={getVars(rule.id).vehicle_model}
                              onChange={(e) => setVars(rule.id, { vehicle_model: e.target.value })}
                              className="h-8 text-xs"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase text-muted-foreground">Booking date</Label>
                            <Input
                              type="date"
                              value={getVars(rule.id).booking_date}
                              onChange={(e) => setVars(rule.id, { booking_date: e.target.value })}
                              className="h-8 text-xs"
                            />
                          </div>
                        </div>
                        <div className="rounded-md bg-[#dcf8c6] dark:bg-emerald-900/30 text-foreground p-3 shadow-sm max-w-md whitespace-pre-wrap text-sm leading-relaxed">
                          {rule.template_name && !rule.message_body?.trim() ? (
                            <span className="text-xs text-muted-foreground italic">
                              Uses WhatsApp template <code>{rule.template_name}</code> — preview unavailable for templates.
                            </span>
                          ) : rule.message_body?.trim() ? (
                            renderTemplate(rule.message_body, getVars(rule.id) as unknown as Record<string, string>)
                          ) : (
                            <span className="text-xs text-muted-foreground italic">
                              Add a message body to see the preview.
                            </span>
                          )}
                        </div>
                      </div>
                    )}
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

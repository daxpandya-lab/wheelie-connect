import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Plus, KeyRound, Code2, Loader2, Eye, EyeOff, RefreshCw, Ban } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

interface ApiKeyRow {
  id: string;
  token_prefix: string;
  label: string | null;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

const SAMPLE_JSON = `[
  {
    "id": "b3c2e0a1-...-9f12",
    "customer_name": "Rahul Sharma",
    "phone_number": "+919812345678",
    "vehicle": {
      "make": "Hyundai",
      "model": "Creta",
      "registration": "DL3CAB1234",
      "year": 2022
    },
    "appointment_date": "2026-06-24",
    "service_type": "Periodic Maintenance",
    "status": "confirmed",
    "estimate_amount": 8450.00,
    "created_at": "2026-06-22T11:14:00Z"
  }
]`;

export default function IntegrationsPage() {
  const { tenantId } = useAuth();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [graceById, setGraceById] = useState<Record<string, number>>({});
  const graceFor = (id: string) => graceById[id] ?? 24;
  const setGrace = (id: string, hours: number) => setGraceById((m) => ({ ...m, [id]: hours }));
  const GRACE_CHOICES: { value: number; label: string }[] = [
    { value: 0, label: "Immediate (no overlap)" },
    { value: 1, label: "1 hour overlap" },
    { value: 24, label: "24 hours overlap" },
    { value: 72, label: "3 days overlap" },
    { value: 168, label: "7 days overlap" },
  ];

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await supabase
      .from("tenant_api_keys" as any)
      .select("id, token_prefix, label, created_at, revoked_at, last_used_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    setKeys(((data as any) ?? []) as ApiKeyRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [tenantId]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-tenant-api-key", { body: {} });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setFreshToken((data as any).token);
      setRevealed(true);
      toast({ title: "API key created", description: "Copy and store it now — it won't be shown again." });
      load();
    } catch (e: any) {
      toast({ title: "Could not generate key", description: e?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const revoke = async (id: string, graceHours = 0) => {
    const revokeAt = new Date(Date.now() + graceHours * 3600_000).toISOString();
    const { error } = await supabase
      .from("tenant_api_keys" as any)
      .update({ revoked_at: revokeAt } as any)
      .eq("id", id);
    if (error) {
      toast({ title: "Could not revoke key", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: graceHours > 0 ? "Revocation scheduled" : "API key revoked",
      description: graceHours > 0
        ? `Old key will keep working until ${new Date(revokeAt).toLocaleString()}.`
        : "Requests using this key will be rejected immediately.",
    });
    load();
  };

  const regenerate = async (id: string, graceHours: number) => {
    // Schedule old key to expire after the grace period, then mint a brand-new key
    // so integrations can be updated without downtime.
    await revoke(id, graceHours);
    await generate();
  };

  // Status helpers: a key with a future revoked_at is still active but in a grace window.
  const keyStatus = (k: ApiKeyRow): { label: string; tone: "active" | "grace" | "revoked"; until?: string } => {
    if (!k.revoked_at) return { label: "Active", tone: "active" };
    const ts = new Date(k.revoked_at).getTime();
    if (ts > Date.now()) return { label: "Grace", tone: "grace", until: k.revoked_at };
    return { label: "Revoked", tone: "revoked" };
  };

  const copy = async (txt: string) => {
    await navigator.clipboard.writeText(txt);
    toast({ title: "Copied to clipboard" });
  };

  const masked = (t: string) => `${t.slice(0, 12)}${"•".repeat(20)}${t.slice(-4)}`;
  const endpoint = `https://api.dealerdoodle.com/v1/bookings?api_key=YOUR_KEY`;

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <TopBar title="Integrations & API" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* API Token Key Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                <CardTitle>API Token Key</CardTitle>
              </div>
              <CardDescription>
                Generate a private token scoped to your dealership. Use it as the <code>api_key</code> query parameter when calling read endpoints.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={generate} disabled={generating} className="gap-2">
                {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Generate Private API Key
              </Button>

              {freshToken && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <div className="text-xs font-medium text-primary uppercase tracking-wide">
                    New key — save it now
                  </div>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={revealed ? freshToken : masked(freshToken)} className="font-mono text-xs" />
                    <Button size="icon" variant="outline" onClick={() => setRevealed((r) => !r)}>
                      {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                    <Button size="icon" variant="outline" onClick={() => copy(freshToken)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This is the only time the full token is shown. After leaving this page only the prefix remains visible.
                  </p>
                </div>
              )}

              <div>
                <div className="text-sm font-medium mb-2">Existing keys</div>
                {loading ? (
                  <div className="text-sm text-muted-foreground">Loading…</div>
                ) : keys.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No keys yet.</div>
                ) : (
                  <ul className="space-y-2">
                    {keys.map((k) => {
                      const st = keyStatus(k);
                      return (
                      <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                        <div className="flex items-center gap-2 font-mono min-w-0">
                          <span className="truncate">{k.token_prefix}••••</span>
                          {st.tone === "revoked" && <Badge variant="destructive">Revoked</Badge>}
                          {st.tone === "grace" && (
                            <Badge variant="secondary" title={`Expires ${new Date(st.until!).toLocaleString()}`}>
                              Grace · until {new Date(st.until!).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            {new Date(k.created_at).toLocaleDateString()}
                          </span>
                          {st.tone !== "revoked" && (
                            <>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="outline" className="gap-1">
                                    <RefreshCw className="w-3 h-3" /> Regenerate
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Rotate this API key safely?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      A new key will be issued immediately. The current key keeps working during
                                      the overlap window you choose, giving you time to update every integration
                                      before the old key stops accepting requests.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <div className="space-y-2 py-2">
                                    <label className="text-sm font-medium">Overlap (grace) period</label>
                                    <select
                                      className="w-full rounded border bg-background p-2 text-sm"
                                      value={graceFor(k.id)}
                                      onChange={(e) => setGrace(k.id, Number(e.target.value))}
                                    >
                                      {GRACE_CHOICES.map((c) => (
                                        <option key={c.value} value={c.value}>{c.label}</option>
                                      ))}
                                    </select>
                                    <p className="text-xs text-muted-foreground">
                                      {graceFor(k.id) === 0
                                        ? "Old key is revoked instantly — any integration still using it will break."
                                        : `Old key will be auto-revoked at ${new Date(Date.now() + graceFor(k.id) * 3600_000).toLocaleString()}.`}
                                    </p>
                                  </div>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => regenerate(k.id, graceFor(k.id))}>
                                      Issue new key
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="ghost" className="gap-1 text-destructive hover:text-destructive">
                                    <Ban className="w-3 h-3" /> Revoke
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Revoke this API key?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      All requests authenticated with this key will be rejected immediately.
                                      This cannot be undone — generate a new key if you need continued access.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => revoke(k.id, 0)}>
                                      Revoke key
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                        </div>
                      </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Documentation Card */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-primary" />
                <CardTitle>Endpoint Documentation</CardTitle>
              </div>
              <CardDescription>
                Read-only HTTP GET endpoint. Returns the dealership's recent bookings as JSON for legacy CRM sync.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm font-medium mb-2">Endpoint</div>
                <div className="flex items-center gap-2">
                  <Input readOnly value={endpoint} className="font-mono text-xs" />
                  <Button size="icon" variant="outline" onClick={() => copy(endpoint)}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div>
                <div className="text-sm font-medium mb-2">Sample response</div>
                <pre className="rounded-md border bg-muted/40 p-3 text-xs overflow-x-auto">
{SAMPLE_JSON}
                </pre>
                <Button size="sm" variant="outline" className="mt-2 gap-2" onClick={() => copy(SAMPLE_JSON)}>
                  <Copy className="w-3 h-3" /> Copy sample
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

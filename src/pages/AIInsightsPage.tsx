import { useState } from "react";
import TopBar from "@/components/TopBar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Brain, TrendingDown, Car, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Insights {
  workload_bottlenecks: string[];
  revenue_leakage: string[];
  vehicle_insights: string[];
}

export default function AIInsightsPage() {
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<Insights | null>(null);

  const runDiagnosis = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-insights", { body: {} });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setInsights((data as any).insights);
      toast({ title: "Diagnosis complete", description: "AI analysis generated successfully." });
    } catch (e: any) {
      toast({ title: "Diagnosis failed", description: e?.message ?? "Try again later.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const sections = [
    { key: "workload_bottlenecks" as const, title: "🔮 Predictive Workload Bottlenecks", icon: Brain, accent: "from-blue-500/10 to-blue-500/5" },
    { key: "revenue_leakage" as const, title: "💡 Revenue Leakage Analysis", icon: TrendingDown, accent: "from-amber-500/10 to-amber-500/5" },
    { key: "vehicle_insights" as const, title: "🚗 Targeted Vehicle Insights", icon: Car, accent: "from-emerald-500/10 to-emerald-500/5" },
  ];

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden">
      <TopBar title="AI Insights" subtitle="AI-generated executive diagnosis from your live workshop data" />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
          <CardHeader>
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="w-5 h-5" />
              <CardTitle className="text-xl">AI Performance Diagnosis</CardTitle>
            </div>
            <CardDescription>
              Aggregates your bookings, leads, drop-off rates, vehicle mix, and feedback and asks the AI for an executive summary. Read-only — nothing in your data is modified.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button size="lg" onClick={runDiagnosis} disabled={loading} className="gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {loading ? "Analyzing your workshop…" : "✨ Run AI Performance Diagnosis"}
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {sections.map((s) => {
            const Icon = s.icon;
            const items = insights?.[s.key] ?? [];
            return (
              <Card key={s.key} className={`bg-gradient-to-br ${s.accent} border-border`}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Icon className="w-5 h-5 text-primary" />
                    <CardTitle className="text-base">{s.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  {!insights && !loading && (
                    <p className="text-sm text-muted-foreground">Run a diagnosis to populate this card.</p>
                  )}
                  {loading && !insights && (
                    <div className="space-y-2">
                      <div className="h-3 bg-muted animate-pulse rounded" />
                      <div className="h-3 bg-muted animate-pulse rounded w-4/5" />
                      <div className="h-3 bg-muted animate-pulse rounded w-3/5" />
                    </div>
                  )}
                  {insights && items.length === 0 && (
                    <p className="text-sm text-muted-foreground">No signal detected for this segment yet.</p>
                  )}
                  {items.length > 0 && (
                    <ul className="space-y-2">
                      {items.map((it, i) => (
                        <li key={i} className="text-sm leading-relaxed flex gap-2">
                          <span className="text-primary mt-1">•</span>
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

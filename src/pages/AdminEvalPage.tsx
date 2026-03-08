import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/hooks/useAdmin";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, Target, AlertCircle, Loader2, Shield, Zap, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface PropOutcome {
  id: string;
  game_date: string;
  player_name: string;
  stat_type: string;
  threshold: number;
  confidence_score: number | null;
  value_score: number | null;
  volatility_score: number | null;
  actual_value: number | null;
  hit: boolean | null;
  reason_tags: string[] | null;
}

interface SlipOutcome {
  id: string;
  slip_name: string;
  risk_label: string;
  estimated_odds: string | null;
  leg_count: number;
  legs_hit: number | null;
  slip_hit: boolean | null;
  game_date: string;
  prompt: string | null;
}

function bucketLabel(score: number | null): string {
  if (score == null) return "N/A";
  if (score >= 70) return "70-100";
  if (score >= 50) return "50-69";
  if (score >= 30) return "30-49";
  return "0-29";
}

function computeBucketStats(props: PropOutcome[], field: "confidence_score" | "value_score" | "volatility_score") {
  const buckets: Record<string, { hit: number; total: number }> = {
    "70-100": { hit: 0, total: 0 },
    "50-69": { hit: 0, total: 0 },
    "30-49": { hit: 0, total: 0 },
    "0-29": { hit: 0, total: 0 },
  };

  for (const p of props) {
    if (p.hit == null) continue;
    const b = bucketLabel(p[field]);
    if (b === "N/A") continue;
    buckets[b].total++;
    if (p.hit) buckets[b].hit++;
  }

  return Object.entries(buckets).map(([range, { hit, total }]) => ({
    range,
    hit,
    total,
    rate: total > 0 ? Math.round((hit / total) * 100) : null,
  }));
}

function computeStatTypeStats(props: PropOutcome[]) {
  const stats: Record<string, { hit: number; total: number }> = {};
  for (const p of props) {
    if (p.hit == null) continue;
    if (!stats[p.stat_type]) stats[p.stat_type] = { hit: 0, total: 0 };
    stats[p.stat_type].total++;
    if (p.hit) stats[p.stat_type].hit++;
  }
  return Object.entries(stats)
    .map(([stat, { hit, total }]) => ({ stat, hit, total, rate: Math.round((hit / total) * 100) }))
    .sort((a, b) => b.rate - a.rate);
}

function computeRiskStats(slips: SlipOutcome[]) {
  const stats: Record<string, { hit: number; total: number }> = {};
  for (const s of slips) {
    if (s.slip_hit == null) continue;
    if (!stats[s.risk_label]) stats[s.risk_label] = { hit: 0, total: 0 };
    stats[s.risk_label].total++;
    if (s.slip_hit) stats[s.risk_label].hit++;
  }
  return Object.entries(stats).map(([label, { hit, total }]) => ({
    label,
    hit,
    total,
    rate: Math.round((hit / total) * 100),
  }));
}

function computeLegCountStats(slips: SlipOutcome[]) {
  const stats: Record<number, { hit: number; total: number }> = {};
  for (const s of slips) {
    if (s.slip_hit == null) continue;
    if (!stats[s.leg_count]) stats[s.leg_count] = { hit: 0, total: 0 };
    stats[s.leg_count].total++;
    if (s.slip_hit) stats[s.leg_count].hit++;
  }
  return Object.entries(stats)
    .map(([count, { hit, total }]) => ({ count: Number(count), hit, total, rate: Math.round((hit / total) * 100) }))
    .sort((a, b) => a.count - b.count);
}

function HitRateBar({ rate, total }: { rate: number | null; total: number }) {
  if (rate == null || total === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const color = rate >= 60 ? "bg-green-500" : rate >= 40 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${rate}%` }} />
      </div>
      <span className="text-xs font-mono">{rate}% ({total})</span>
    </div>
  );
}

export default function AdminEvalPage() {
  const { isAdmin, isLoading: adminLoading } = useAdmin();
  const navigate = useNavigate();
  const [grading, setGrading] = useState(false);

  const { data: propOutcomes = [], isLoading: propsLoading } = useQuery({
    queryKey: ["prop-outcomes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("prop_outcomes")
        .select("*")
        .not("hit", "is", null)
        .order("game_date", { ascending: false })
        .limit(500);
      return (data || []) as PropOutcome[];
    },
    enabled: isAdmin,
  });

  const { data: slipOutcomes = [], isLoading: slipsLoading, refetch } = useQuery({
    queryKey: ["slip-outcomes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("slip_outcomes")
        .select("*")
        .order("game_date", { ascending: false })
        .limit(200);
      return (data || []) as SlipOutcome[];
    },
    enabled: isAdmin,
  });

  const handleGrade = async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    setGrading(true);
    try {
      const { data, error } = await supabase.functions.invoke("grade-outcomes", {
        body: { game_date: dateStr },
      });
      if (error) throw error;
      toast({ title: "Grading complete", description: `Props: ${data.graded_props}, Slips: ${data.graded_slips}` });
      refetch();
    } catch (e) {
      toast({ title: "Grading failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setGrading(false);
    }
  };

  if (adminLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card><CardContent className="pt-6 text-center space-y-2">
          <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
          <p className="font-semibold">Admin access required</p>
          <Button variant="outline" onClick={() => navigate("/")}>Go Home</Button>
        </CardContent></Card>
      </div>
    );
  }

  const isLoading = propsLoading || slipsLoading;
  const confidenceStats = computeBucketStats(propOutcomes, "confidence_score");
  const valueStats = computeBucketStats(propOutcomes, "value_score");
  const volatilityStats = computeBucketStats(propOutcomes, "volatility_score");
  const statTypeStats = computeStatTypeStats(propOutcomes);
  const riskStats = computeRiskStats(slipOutcomes);
  const legCountStats = computeLegCountStats(slipOutcomes);

  const totalProps = propOutcomes.length;
  const totalHits = propOutcomes.filter((p) => p.hit).length;
  const overallHitRate = totalProps > 0 ? Math.round((totalHits / totalProps) * 100) : null;

  const totalSlips = slipOutcomes.filter((s) => s.slip_hit != null).length;
  const slipHits = slipOutcomes.filter((s) => s.slip_hit === true).length;
  const slipHitRate = totalSlips > 0 ? Math.round((slipHits / totalSlips) * 100) : null;

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Scoring Engine Eval
            </h1>
            <p className="text-xs text-muted-foreground">Performance tracking for AI props & slips</p>
          </div>
          <Button size="sm" onClick={handleGrade} disabled={grading}>
            {grading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Grade Yesterday
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
        ) : (
          <>
            {/* Overview Cards */}
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-primary">{overallHitRate != null ? `${overallHitRate}%` : "—"}</div>
                  <div className="text-xs text-muted-foreground">Prop Hit Rate ({totalProps})</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-primary">{slipHitRate != null ? `${slipHitRate}%` : "—"}</div>
                  <div className="text-xs text-muted-foreground">Slip Hit Rate ({totalSlips})</div>
                </CardContent>
              </Card>
            </div>

            {/* Confidence Score Buckets */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  Hit Rate by Confidence Score
                </h3>
                {confidenceStats.map((b) => (
                  <div key={b.range} className="flex items-center justify-between">
                    <span className="text-xs font-mono w-16">{b.range}</span>
                    <HitRateBar rate={b.rate} total={b.total} />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Value Score Buckets */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Hit Rate by Value Score
                </h3>
                {valueStats.map((b) => (
                  <div key={b.range} className="flex items-center justify-between">
                    <span className="text-xs font-mono w-16">{b.range}</span>
                    <HitRateBar rate={b.rate} total={b.total} />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Stat Type Performance */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <h3 className="text-sm font-semibold">Hit Rate by Stat Type</h3>
                {statTypeStats.map((s) => (
                  <div key={s.stat} className="flex items-center justify-between">
                    <span className="text-xs font-medium w-16">{s.stat}</span>
                    <HitRateBar rate={s.rate} total={s.total} />
                  </div>
                ))}
                {statTypeStats.length === 0 && <p className="text-xs text-muted-foreground">No graded data yet</p>}
              </CardContent>
            </Card>

            {/* Slip Risk Label Performance */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  Slip Hit Rate by Risk Label
                </h3>
                {riskStats.map((r) => (
                  <div key={r.label} className="flex items-center justify-between">
                    <Badge variant="outline" className="text-[10px]">{r.label}</Badge>
                    <HitRateBar rate={r.rate} total={r.total} />
                  </div>
                ))}
                {riskStats.length === 0 && <p className="text-xs text-muted-foreground">No graded slips yet</p>}
              </CardContent>
            </Card>

            {/* Slip Hit Rate by Leg Count */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Zap className="h-4 w-4 text-primary" />
                  Slip Hit Rate by Leg Count
                </h3>
                {legCountStats.map((l) => (
                  <div key={l.count} className="flex items-center justify-between">
                    <span className="text-xs font-mono w-16">{l.count}-leg</span>
                    <HitRateBar rate={l.rate} total={l.total} />
                  </div>
                ))}
                {legCountStats.length === 0 && <p className="text-xs text-muted-foreground">No graded slips yet</p>}
              </CardContent>
            </Card>

            {/* Volatility Score Buckets */}
            <Card>
              <CardContent className="pt-4 space-y-3">
                <h3 className="text-sm font-semibold">Hit Rate by Volatility Score</h3>
                {volatilityStats.map((b) => (
                  <div key={b.range} className="flex items-center justify-between">
                    <span className="text-xs font-mono w-16">{b.range}</span>
                    <HitRateBar rate={b.rate} total={b.total} />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Recent Prop Outcomes */}
            <Card>
              <CardContent className="pt-4 space-y-2">
                <h3 className="text-sm font-semibold">Recent Prop Outcomes</h3>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {propOutcomes.slice(0, 30).map((p) => (
                    <div key={p.id} className="flex items-center justify-between text-xs py-1 border-b border-border/20">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${p.hit ? "bg-green-500" : "bg-red-500"}`} />
                        <span className="truncate">{p.player_name}</span>
                        <span className="text-muted-foreground">{p.stat_type} {p.threshold}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono">{p.actual_value ?? "—"}</span>
                        <span className="text-muted-foreground">C:{p.confidence_score ?? "—"}</span>
                      </div>
                    </div>
                  ))}
                  {propOutcomes.length === 0 && <p className="text-xs text-muted-foreground py-4 text-center">No outcomes graded yet. Click "Grade Yesterday" to start.</p>}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

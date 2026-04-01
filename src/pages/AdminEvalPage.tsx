import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdmin } from "@/hooks/useAdmin";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, TrendingDown, Target, AlertCircle, Loader2, Shield, Zap, RefreshCw, Calendar, Users, CheckCircle, AlertTriangle, Brain, Scale, Eye, Database, Clock, PlayCircle, Workflow } from "lucide-react";
import { DataQualityCard } from "@/components/admin/DataQualityCard";
import { SlipValidationReview } from "@/components/admin/SlipValidationReview";
import { toast } from "@/hooks/use-toast";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell } from "recharts";

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

interface DailySnapshot {
  snapshot_date: string;
  prop_total: number;
  prop_hits: number;
  prop_hit_rate: number | null;
  slip_total: number;
  slip_hits: number;
  slip_hit_rate: number | null;
  confidence_buckets: any;
  value_buckets: any;
  stat_type_buckets: any;
  risk_label_buckets: any;
}

function bucketLabel(score: number | null): string {
  if (score == null) return "N/A";
  if (score >= 70) return "70-100";
  if (score >= 50) return "50-69";
  if (score >= 30) return "30-49";
  return "0-29";
}

function fineBucketLabel(score: number | null): string {
  if (score == null) return "N/A";
  if (score >= 80) return "80+";
  if (score >= 70) return "70-79";
  if (score >= 60) return "60-69";
  if (score >= 50) return "50-59";
  if (score >= 40) return "40-49";
  if (score >= 30) return "30-39";
  return "0-29";
}

function computeCalibrationData(props: PropOutcome[]) {
  const bucketOrder = ["0-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80+"];
  const targets: Record<string, number> = {
    "0-29": 30, "30-39": 38, "40-49": 43, "50-59": 48, "60-69": 53, "70-79": 58, "80+": 65,
  };
  const buckets: Record<string, { hit: number; total: number }> = {};
  for (const b of bucketOrder) buckets[b] = { hit: 0, total: 0 };

  for (const p of props) {
    if (p.hit == null || p.confidence_score == null) continue;
    const b = fineBucketLabel(p.confidence_score);
    if (b === "N/A") continue;
    buckets[b].total++;
    if (p.hit) buckets[b].hit++;
  }

  return bucketOrder.map(b => ({
    bucket: b,
    actual: buckets[b].total > 0 ? Math.round((buckets[b].hit / buckets[b].total) * 100) : null,
    target: targets[b],
    total: buckets[b].total,
    midpoint: b === "80+" ? 85 : b === "0-29" ? 15 : parseInt(b.split("-")[0]) + 5,
  }));
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
    range, hit, total,
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
    label, hit, total, rate: Math.round((hit / total) * 100),
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

function TrendIndicator({ snapshots, field }: { snapshots: DailySnapshot[]; field: "prop_hit_rate" | "slip_hit_rate" }) {
  if (snapshots.length < 2) return null;
  const recent = snapshots.slice(0, 3).filter(s => s[field] != null);
  const older = snapshots.slice(3, 7).filter(s => s[field] != null);
  if (recent.length === 0 || older.length === 0) return null;

  const recentAvg = recent.reduce((s, r) => s + (r[field] || 0), 0) / recent.length;
  const olderAvg = older.reduce((s, r) => s + (r[field] || 0), 0) / older.length;
  const diff = recentAvg - olderAvg;

  if (Math.abs(diff) < 1) return <span className="text-[10px] text-muted-foreground ml-1">→ stable</span>;
  return diff > 0
    ? <span className="text-[10px] text-green-400 ml-1 flex items-center gap-0.5"><TrendingUp className="h-3 w-3" />+{diff.toFixed(1)}%</span>
    : <span className="text-[10px] text-red-400 ml-1 flex items-center gap-0.5"><TrendingDown className="h-3 w-3" />{diff.toFixed(1)}%</span>;
}

export default function AdminEvalPage() {
  const { isAdmin, isLoading: adminLoading } = useAdmin();
  const navigate = useNavigate();
  const [grading, setGrading] = useState(false);
  const [refreshingAvail, setRefreshingAvail] = useState(false);

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

  const { data: snapshots = [], isLoading: snapsLoading } = useQuery({
    queryKey: ["eval-snapshots"],
    queryFn: async () => {
      const { data } = await supabase
        .from("eval_daily_snapshots")
        .select("*")
        .order("snapshot_date", { ascending: true })
        .limit(90);
      return (data || []) as DailySnapshot[];
    },
    enabled: isAdmin,
  });

  // Availability status query
  const todayStr = new Date().toISOString().split("T")[0];
  const { data: availStatus, isLoading: availLoading, refetch: refetchAvail } = useQuery({
    queryKey: ["avail-status", todayStr],
    queryFn: async () => {
      // Get today's availability records
      const { data: avail } = await supabase
        .from("player_availability")
        .select("player_id, player_name, team_abbr, status, updated_at")
        .eq("game_date", todayStr);

      // Get today's games for coverage check
      const { data: games } = await supabase
        .from("games_today")
        .select("home_team_abbr, away_team_abbr")
        .eq("game_date", todayStr)
        .eq("sport", "NBA");

      // Get availability refresh timestamp
      const { data: refreshRow } = await supabase
        .from("refresh_status")
        .select("last_run")
        .eq("id", 2)
        .maybeSingle();

      const teamsPlaying = new Set<string>();
      for (const g of games || []) {
        if (g.home_team_abbr) teamsPlaying.add(g.home_team_abbr);
        if (g.away_team_abbr) teamsPlaying.add(g.away_team_abbr);
      }

      const teamsCovered = new Set((avail || []).map(a => a.team_abbr).filter(Boolean));
      const teamsMissing = [...teamsPlaying].filter(t => !teamsCovered.has(t));

      const statusBreakdown: Record<string, number> = {};
      for (const a of avail || []) {
        statusBreakdown[a.status] = (statusBreakdown[a.status] || 0) + 1;
      }

      const lastRefresh = refreshRow?.last_run ? new Date(refreshRow.last_run) : null;
      const hoursSince = lastRefresh ? (Date.now() - lastRefresh.getTime()) / (1000 * 60 * 60) : null;

      return {
        total: avail?.length || 0,
        teamsPlaying: teamsPlaying.size,
        teamsCovered: teamsCovered.size,
        teamsMissing,
        statusBreakdown,
        lastRefresh,
        hoursSince,
        isFresh: hoursSince !== null && hoursSince <= 6,
      };
    },
    enabled: isAdmin,
  });

  // Line snapshot status query
  const { data: snapStatus, isLoading: snapLoading, refetch: refetchSnap } = useQuery({
    queryKey: ["snap-status", todayStr],
    queryFn: async () => {
      const { count: totalToday } = await supabase
        .from("line_snapshots")
        .select("id", { count: "exact", head: true })
        .eq("game_date", todayStr);

      const { data: uniqueProps } = await supabase
        .from("line_snapshots")
        .select("player_name, stat_type")
        .eq("game_date", todayStr);

      const uniqueKeys = new Set((uniqueProps || []).map(p => `${p.player_name}|${p.stat_type}`));

      const { data: refreshRow } = await supabase
        .from("refresh_status")
        .select("last_run")
        .eq("id", 3)
        .maybeSingle();

      const lastRefresh = refreshRow?.last_run ? new Date(refreshRow.last_run) : null;
      const hoursSince = lastRefresh ? (Date.now() - lastRefresh.getTime()) / (1000 * 60 * 60) : null;

      return {
        totalToday: totalToday || 0,
        uniqueProps: uniqueKeys.size,
        lastRefresh,
        hoursSince,
      };
    },
    enabled: isAdmin,
  });

  // Factor analysis query
  const { data: factorAnalysis, isLoading: factorLoading, refetch: refetchAnalysis } = useQuery({
    queryKey: ["factor-analysis"],
    queryFn: async () => {
      const { data } = await supabase
        .from("factor_analysis_snapshots")
        .select("*")
        .order("analysis_date", { ascending: false })
        .limit(1);
      return data?.[0] || null;
    },
    enabled: isAdmin,
  });

  // Scoring weights query
  const { data: activeWeights } = useQuery({
    queryKey: ["scoring-weights"],
    queryFn: async () => {
      const { data } = await supabase
        .from("scoring_weights")
        .select("*")
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
    enabled: isAdmin,
  });

  const [refreshingSnap, setRefreshingSnap] = useState(false);
  const [analyzingFactors, setAnalyzingFactors] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<any>(null);

  // Pipeline status query
  const { data: pipelineStatus } = useQuery({
    queryKey: ["pipeline-status"],
    queryFn: async () => {
      const { data: row } = await supabase
        .from("refresh_status")
        .select("last_run")
        .eq("id", 4)
        .maybeSingle();
      const lastRun = row?.last_run ? new Date(row.last_run) : null;
      const hoursSince = lastRun ? (Date.now() - lastRun.getTime()) / (1000 * 60 * 60) : null;
      return { lastRun, hoursSince };
    },
    enabled: isAdmin,
  });

  // Pipeline run history query
  const { data: pipelineHistory = [], refetch: refetchHistory } = useQuery({
    queryKey: ["pipeline-history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("pipeline_runs")
        .select("*")
        .order("ran_at", { ascending: false })
        .limit(15);
      return data || [];
    },
    enabled: isAdmin,
  });

  // Learning loop status query
  const { data: loopStatus } = useQuery({
    queryKey: ["learning-loop-status"],
    queryFn: async () => {
      // Total graded props
      const { count: gradedProps } = await supabase
        .from("prop_outcomes")
        .select("id", { count: "exact", head: true })
        .not("hit", "is", null);

      // Total graded slips
      const { count: gradedSlips } = await supabase
        .from("slip_outcomes")
        .select("id", { count: "exact", head: true })
        .not("slip_hit", "is", null);

      // Last grading run (most recent graded_at)
      const { data: lastGrade } = await supabase
        .from("prop_outcomes")
        .select("graded_at")
        .not("graded_at", "is", null)
        .order("graded_at", { ascending: false })
        .limit(1);

      // Last scoring analysis
      const { data: lastAnalysis } = await supabase
        .from("factor_analysis_snapshots")
        .select("created_at, sample_size, analysis_date")
        .order("created_at", { ascending: false })
        .limit(1);

      // Cron schedule info
      const lastGradeTime = lastGrade?.[0]?.graded_at ? new Date(lastGrade[0].graded_at) : null;
      const lastAnalysisTime = lastAnalysis?.[0]?.created_at ? new Date(lastAnalysis[0].created_at) : null;
      const gradeHoursAgo = lastGradeTime ? (Date.now() - lastGradeTime.getTime()) / (1000 * 60 * 60) : null;
      const analysisHoursAgo = lastAnalysisTime ? (Date.now() - lastAnalysisTime.getTime()) / (1000 * 60 * 60) : null;

      return {
        gradedProps: gradedProps || 0,
        gradedSlips: gradedSlips || 0,
        lastGradeTime,
        lastAnalysisTime,
        gradeHoursAgo,
        analysisHoursAgo,
        lastAnalysisSample: lastAnalysis?.[0]?.sample_size || 0,
        lastAnalysisDate: lastAnalysis?.[0]?.analysis_date || null,
      };
    },
    enabled: isAdmin,
  });

  const handleRunAnalysis = async () => {
    setAnalyzingFactors(true);
    try {
      const { data, error } = await supabase.functions.invoke("scoring-analysis", { body: { lookback_days: 30 } });
      if (error) throw error;
      toast({ title: "Analysis complete", description: `${data.sample_size} props analyzed, ${data.recommendations?.length || 0} recommendations` });
      refetchAnalysis();
    } catch (e) {
      toast({ title: "Analysis failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setAnalyzingFactors(false);
    }
  };
  const handleRefreshSnap = async () => {
    setRefreshingSnap(true);
    try {
      const { data, error } = await supabase.functions.invoke("collect-line-snapshots", { body: {} });
      if (error) throw error;
      toast({ title: "Snapshots collected", description: `${data.new_snapshots} new, ${data.skipped_dupes} dupes skipped` });
      refetchSnap();
    } catch (e) {
      toast({ title: "Snapshot collection failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setRefreshingSnap(false);
    }
  };

  const handleRefreshAvail = async () => {
    setRefreshingAvail(true);
    try {
      const { data, error } = await supabase.functions.invoke("refresh-availability", { body: {} });
      if (error) throw error;
      toast({ title: "Availability refreshed", description: `${data.records} records for ${data.teams_covered}/${data.teams_playing} teams` });
      refetchAvail();
    } catch (e) {
      toast({ title: "Availability refresh failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setRefreshingAvail(false);
    }
  };

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

  const handleBackfill = async () => {
    setBackfilling(true);
    try {
      const { data, error } = await supabase.functions.invoke("backfill-outcomes", {
        body: { lookback_days: 30 },
      });
      if (error) throw error;
      toast({ title: "Backfill complete", description: `${data.outcomes_generated} outcomes generated across ${data.dates_processed} dates` });
      refetch();
    } catch (e) {
      toast({ title: "Backfill failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setBackfilling(false);
    }
  };

  const handleRunPipeline = async () => {
    setRunningPipeline(true);
    setPipelineResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("run-daily-pipeline", { body: {} });
      if (error) throw error;
      setPipelineResult(data);
      toast({
        title: data.success ? "Pipeline complete ✅" : "Pipeline partial ⚠️",
        description: `Lines: ${data.results?.line_collection?.new_snapshots || 0} new | Avail: ${data.results?.availability_refresh?.records || 0} | Scored: ${data.results?.scoring?.scored_count || 0} | ${Math.round(data.total_duration_ms / 1000)}s`,
      });
      refetchHistory();
    } catch (e) {
      toast({ title: "Pipeline failed", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setRunningPipeline(false);
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

  const isLoading = propsLoading || slipsLoading || snapsLoading;
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

  // Prepare chart data from snapshots
  const chartData = snapshots
    .filter(s => s.prop_hit_rate != null || s.slip_hit_rate != null)
    .map(s => ({
      date: s.snapshot_date.slice(5), // MM-DD
      props: s.prop_hit_rate,
      slips: s.slip_hit_rate,
      propN: s.prop_total,
      slipN: s.slip_total,
    }));

  const sortedSnapshots = [...snapshots].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));

  // Derive pipeline alert state from history
  const latestRun = pipelineHistory.length > 0 ? pipelineHistory[0] : null;
  const latestFailed = latestRun && (!latestRun.success || (latestRun.errors && latestRun.errors.length > 0));
  const lastSuccessRun = pipelineHistory.find((r: any) => r.success && (!r.errors || r.errors.length === 0));
  const lastSuccessTime = lastSuccessRun ? new Date(lastSuccessRun.ran_at) : null;
  const hoursSinceSuccess = lastSuccessTime ? (Date.now() - lastSuccessTime.getTime()) / (1000 * 60 * 60) : null;
  const pipelineStale = hoursSinceSuccess === null || hoursSinceSuccess > 6;

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        {/* Pipeline Failure Banner */}
        {latestFailed && latestRun && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="font-semibold text-destructive">Pipeline failed</span>
              <span className="text-muted-foreground ml-1.5">
                {new Date(latestRun.ran_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}
              </span>
              {latestRun.errors?.[0] && (
                <p className="text-xs text-destructive/80 mt-0.5 truncate">{latestRun.errors[0]}</p>
              )}
            </div>
          </div>
        )}

        {/* Stale Pipeline Warning */}
        {!latestFailed && pipelineStale && (
          <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="font-semibold text-yellow-600">Pipeline may be stale</span>
              <span className="text-xs text-muted-foreground ml-1.5">
                — No successful run in the last 6 hours
              </span>
            </div>
          </div>
        )}

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

        {/* Pipeline Orchestration */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Workflow className="h-4 w-4 text-primary" />
                Daily Pipeline
              </h3>
              <Button size="sm" onClick={handleRunPipeline} disabled={runningPipeline} className="h-7 text-xs">
                {runningPipeline ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <PlayCircle className="h-3 w-3 mr-1" />}
                {runningPipeline ? "Running…" : "Run Pipeline"}
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-card/50 rounded-lg p-2">
                <div className="text-[10px] text-muted-foreground">Last Run</div>
                <div className="text-xs font-medium">
                  {pipelineStatus?.lastRun
                    ? pipelineStatus.lastRun.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
                    : "Never"}
                </div>
              </div>
              <div className="bg-card/50 rounded-lg p-2">
                <div className="text-[10px] text-muted-foreground">Schedule</div>
                <div className="text-xs font-medium">11am · 3pm · 6pm ET</div>
              </div>
              <div className="bg-card/50 rounded-lg p-2">
                <div className="text-[10px] text-muted-foreground">Status</div>
                <div className="text-xs font-medium">
                  {pipelineStatus?.hoursSince != null && pipelineStatus.hoursSince <= 4
                    ? <Badge variant="outline" className="text-[10px] border-green-500/50 text-green-600">Fresh</Badge>
                    : <Badge variant="outline" className="text-[10px] border-yellow-500/50 text-yellow-600">Stale</Badge>}
                </div>
              </div>
            </div>
            {pipelineResult && (
              <div className="text-[10px] bg-card/50 rounded-lg p-2 space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Lines</span><span>{pipelineResult.results?.line_collection?.new_snapshots || 0} new / {pipelineResult.results?.line_collection?.skipped_dupes || 0} deduped</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Availability</span><span>{pipelineResult.results?.availability_refresh?.records || 0} players</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Scoring</span><span>{pipelineResult.results?.scoring?.scored_count || 0} props scored</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Duration</span><span>{Math.round((pipelineResult.total_duration_ms || 0) / 1000)}s</span></div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pipeline Run History */}
        {pipelineHistory.length > 0 && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Pipeline Run History
              </h3>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {pipelineHistory.map((run: any) => {
                  const ranAt = new Date(run.ran_at);
                  const hasErrors = run.errors && run.errors.length > 0;
                  const isFailed = !run.success || hasErrors;
                  const isSlow = (run.total_duration_ms || 0) > 60000;
                  const rowBg = isFailed
                    ? "bg-destructive/10 border border-destructive/30"
                    : isSlow
                      ? "bg-yellow-500/10 border border-yellow-500/30"
                      : "bg-card/50";
                  return (
                    <div key={run.id} className={`flex items-center gap-2 text-[11px] rounded-lg px-2.5 py-1.5 ${rowBg}`}>
                      {isFailed
                        ? <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                        : <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                      <span className="font-medium min-w-[90px]">
                        {ranAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                        {ranAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                      </span>
                      <span className="text-muted-foreground">
                        {run.line_new_snapshots ?? 0}L · {run.availability_records ?? 0}A · {run.scoring_scored_count ?? 0}S
                      </span>
                      <span className="text-muted-foreground ml-auto">{Math.round((run.total_duration_ms || 0) / 1000)}s</span>
                      {hasErrors && (
                        <span className="text-destructive truncate max-w-[120px]" title={run.errors.join(", ")}>
                          {run.errors[0]}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}


        {loopStatus && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Brain className="h-4 w-4 text-primary" />
                  Learning Loop Status
                </h3>
                <Button size="sm" variant="outline" onClick={handleBackfill} disabled={backfilling} className="h-7 text-xs">
                  {backfilling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Database className="h-3 w-3 mr-1" />}
                  Backfill 30d
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-card/50 rounded-lg p-2.5 text-center">
                  <div className="text-xl font-bold text-primary">{loopStatus.gradedProps.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">Graded Props</div>
                </div>
                <div className="bg-card/50 rounded-lg p-2.5 text-center">
                  <div className="text-xl font-bold text-primary">{loopStatus.gradedSlips.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">Graded Slips</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Last Grading</div>
                    <div className="text-muted-foreground">
                      {loopStatus.lastGradeTime
                        ? `${loopStatus.gradeHoursAgo!.toFixed(1)}h ago`
                        : "Never"}
                    </div>
                  </div>
                  {loopStatus.gradeHoursAgo != null && (
                    loopStatus.gradeHoursAgo <= 26
                      ? <CheckCircle className="h-3.5 w-3.5 text-green-500 ml-auto" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 ml-auto" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Scale className="h-3.5 w-3.5 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Last Analysis</div>
                    <div className="text-muted-foreground">
                      {loopStatus.lastAnalysisTime
                        ? `${loopStatus.analysisHoursAgo!.toFixed(1)}h ago`
                        : "Never"}
                    </div>
                  </div>
                  {loopStatus.analysisHoursAgo != null && (
                    loopStatus.analysisHoursAgo <= 26
                      ? <CheckCircle className="h-3.5 w-3.5 text-green-500 ml-auto" />
                      : <AlertTriangle className="h-3.5 w-3.5 text-yellow-500 ml-auto" />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground border-t border-border/30 pt-2">
                <PlayCircle className="h-3 w-3" />
                <span>Auto: Grade @ 2:30 AM ET → Analysis @ 3:00 AM ET (daily)</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Availability Status */}
        {!availLoading && availStatus && (
          <Card className={availStatus.isFresh ? "border-border" : "border-yellow-500/30"}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  Player Availability
                </h3>
                <Button size="sm" variant="ghost" onClick={handleRefreshAvail} disabled={refreshingAvail} className="h-7 text-xs">
                  {refreshingAvail ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  Refresh
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold text-primary">{availStatus.total}</div>
                  <div className="text-[10px] text-muted-foreground">Records</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-primary">{availStatus.teamsCovered}/{availStatus.teamsPlaying}</div>
                  <div className="text-[10px] text-muted-foreground">Teams</div>
                </div>
                <div>
                  <div className="text-lg font-bold flex items-center justify-center gap-1">
                    {availStatus.isFresh ? (
                      <><CheckCircle className="h-4 w-4 text-green-500" /><span className="text-green-500">Fresh</span></>
                    ) : (
                      <><AlertTriangle className="h-4 w-4 text-yellow-500" /><span className="text-yellow-500">Stale</span></>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {availStatus.hoursSince != null ? `${availStatus.hoursSince.toFixed(1)}h ago` : "Never"}
                  </div>
                </div>
              </div>
              {/* Status breakdown */}
              {Object.keys(availStatus.statusBreakdown).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(availStatus.statusBreakdown).map(([status, count]) => (
                    <Badge key={status} variant="outline" className="text-[10px]">
                      {status}: {count}
                    </Badge>
                  ))}
                </div>
              )}
              {availStatus.teamsMissing.length > 0 && (
                <p className="text-[10px] text-yellow-500">
                  Missing: {availStatus.teamsMissing.join(", ")}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Data Quality */}
        <DataQualityCard />

        {/* Line Snapshot Status */}
        {!snapLoading && snapStatus && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Line Snapshots
                </h3>
                <Button size="sm" variant="ghost" onClick={handleRefreshSnap} disabled={refreshingSnap} className="h-7 text-xs">
                  {refreshingSnap ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  Collect
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold text-primary">{snapStatus.totalToday}</div>
                  <div className="text-[10px] text-muted-foreground">Snapshots</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-primary">{snapStatus.uniqueProps}</div>
                  <div className="text-[10px] text-muted-foreground">Props Tracked</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {snapStatus.lastRefresh
                      ? `${snapStatus.hoursSince!.toFixed(1)}h ago`
                      : "Never"}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Last Run</div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="text-center py-12"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
        ) : (
          <>
            {/* Overview Cards with Trends */}
            <div className="grid grid-cols-2 gap-3">
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-primary flex items-center justify-center">
                    {overallHitRate != null ? `${overallHitRate}%` : "—"}
                    <TrendIndicator snapshots={sortedSnapshots} field="prop_hit_rate" />
                  </div>
                  <div className="text-xs text-muted-foreground">Prop Hit Rate ({totalProps})</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-4 text-center">
                  <div className="text-2xl font-bold text-primary flex items-center justify-center">
                    {slipHitRate != null ? `${slipHitRate}%` : "—"}
                    <TrendIndicator snapshots={sortedSnapshots} field="slip_hit_rate" />
                  </div>
                  <div className="text-xs text-muted-foreground">Slip Hit Rate ({totalSlips})</div>
                </CardContent>
              </Card>
            </div>

            {/* Hit Rate Trend Chart */}
            {chartData.length > 1 && (
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-primary" />
                    Hit Rate Over Time
                  </h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          formatter={(value: number, name: string) => [`${value}%`, name === "props" ? "Prop Hit Rate" : "Slip Hit Rate"]}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="props" name="Props" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="slips" name="Slips" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Daily Snapshot Table */}
            {sortedSnapshots.length > 0 && (
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <h3 className="text-sm font-semibold">Daily Snapshots</h3>
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border/30">
                          <th className="text-left py-1 font-medium">Date</th>
                          <th className="text-center py-1 font-medium">Props</th>
                          <th className="text-center py-1 font-medium">Prop %</th>
                          <th className="text-center py-1 font-medium">Slips</th>
                          <th className="text-center py-1 font-medium">Slip %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedSnapshots.slice(0, 30).map(s => (
                          <tr key={s.snapshot_date} className="border-b border-border/10">
                            <td className="py-1 font-mono">{s.snapshot_date.slice(5)}</td>
                            <td className="text-center">{s.prop_hits}/{s.prop_total}</td>
                            <td className="text-center font-mono">
                              <span className={s.prop_hit_rate != null ? (s.prop_hit_rate >= 50 ? "text-green-400" : "text-red-400") : "text-muted-foreground"}>
                                {s.prop_hit_rate != null ? `${s.prop_hit_rate}%` : "—"}
                              </span>
                            </td>
                            <td className="text-center">{s.slip_hits}/{s.slip_total}</td>
                            <td className="text-center font-mono">
                              <span className={s.slip_hit_rate != null ? (s.slip_hit_rate >= 30 ? "text-green-400" : "text-red-400") : "text-muted-foreground"}>
                                {s.slip_hit_rate != null ? `${s.slip_hit_rate}%` : "—"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

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

            {/* Calibration Chart: Predicted vs Actual */}
            {(() => {
              const calibData = computeCalibrationData(propOutcomes);
              const hasData = calibData.some(d => d.actual != null);
              if (!hasData) return null;
              return (
                <Card className="border-primary/20">
                  <CardContent className="pt-4 space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Target className="h-4 w-4 text-primary" />
                      Confidence Calibration
                    </h3>
                    <p className="text-[10px] text-muted-foreground">
                      Predicted confidence vs actual hit rate — closer to diagonal = better calibrated
                    </p>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={calibData} barGap={0}>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <YAxis domain={[0, 80]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} label={{ value: "Hit Rate %", angle: -90, position: "insideLeft", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                          <Tooltip
                            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                            formatter={(value: number | null, name: string) => [value != null ? `${value}%` : "—", name === "actual" ? "Actual Hit Rate" : "Target Hit Rate"]}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="actual" name="Actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="target" name="Target" fill="hsl(var(--muted-foreground))" opacity={0.3} radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center">
                      {calibData.map(d => (
                        <div key={d.bucket} className="text-[9px]">
                          <div className="font-mono text-muted-foreground">{d.total}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

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

            {/* Slip Validation Review */}
            <SlipValidationReview />

            {/* ===== SCORING INSIGHTS SECTION ===== */}
            <div className="pt-2 border-t border-border/30">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold flex items-center gap-2">
                  <Brain className="h-5 w-5 text-primary" />
                  Scoring Insights
                </h2>
                <Button size="sm" variant="outline" onClick={handleRunAnalysis} disabled={analyzingFactors} className="h-7 text-xs">
                  {analyzingFactors ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Scale className="h-3 w-3 mr-1" />}
                  Run Analysis
                </Button>
              </div>

              {/* Active Weights */}
              {activeWeights && (
                <Card className="mb-3">
                  <CardContent className="pt-4 space-y-2">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <Scale className="h-4 w-4 text-primary" />
                      Active Weights: {activeWeights.label} (v{activeWeights.version})
                    </h3>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(activeWeights.weights as Record<string, number>)
                        .sort(([,a], [,b]) => b - a)
                        .map(([factor, weight]) => (
                          <Badge key={factor} variant="outline" className="text-[10px] font-mono">
                            {factor}: {(weight * 100).toFixed(0)}%
                          </Badge>
                        ))}
                    </div>
                    {activeWeights.notes && <p className="text-[10px] text-muted-foreground">{activeWeights.notes}</p>}
                  </CardContent>
                </Card>
              )}

              {/* Factor Analysis Results */}
              {factorAnalysis && (
                <>
                  {/* Recommendations */}
                  {factorAnalysis.recommendations && (factorAnalysis.recommendations as any[]).length > 0 && (
                    <Card className="mb-3">
                      <CardContent className="pt-4 space-y-2">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-primary" />
                          Recommendations ({(factorAnalysis.recommendations as any[]).length})
                        </h3>
                        <div className="space-y-2">
                          {(factorAnalysis.recommendations as any[]).map((rec: any, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <Badge variant={rec.priority === "high" ? "destructive" : rec.priority === "medium" ? "default" : "secondary"} className="text-[9px] shrink-0 mt-0.5">
                                {rec.priority}
                              </Badge>
                              <div>
                                <span className="font-medium">{rec.type.replace(/_/g, " ")}</span>
                                <span className="text-muted-foreground ml-1">({rec.factor})</span>
                                <p className="text-muted-foreground mt-0.5">{rec.detail}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Score Range Performance */}
                  {factorAnalysis.score_range_performance && (
                    <Card className="mb-3">
                      <CardContent className="pt-4 space-y-2">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <Target className="h-4 w-4 text-primary" />
                          Confidence Score → Actual Hit Rate
                        </h3>
                        <p className="text-[10px] text-muted-foreground">Does confidence score predict outcomes accurately?</p>
                        {Object.entries(factorAnalysis.score_range_performance as Record<string, any>)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([band, data]: [string, any]) => (
                            <div key={band} className="flex items-center justify-between">
                              <span className="text-xs font-mono w-16">{band}</span>
                              <HitRateBar rate={data.rate} total={data.total} />
                            </div>
                          ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Overstatement Analysis */}
                  {factorAnalysis.overstatement_analysis && Object.keys(factorAnalysis.overstatement_analysis as object).length > 0 && (
                    <Card className="mb-3">
                      <CardContent className="pt-4 space-y-2">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <Eye className="h-4 w-4 text-primary" />
                          Confidence Calibration
                        </h3>
                        <p className="text-[10px] text-muted-foreground">Positive = underconfident, Negative = overconfident</p>
                        {Object.entries(factorAnalysis.overstatement_analysis as Record<string, any>)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([bucket, data]: [string, any]) => (
                            <div key={bucket} className="flex items-center justify-between text-xs">
                              <span className="font-mono w-16">{bucket}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-muted-foreground">actual: {data.actual_rate}%</span>
                                <span className={`font-mono font-medium ${data.delta > 5 ? "text-green-400" : data.delta < -5 ? "text-red-400" : "text-muted-foreground"}`}>
                                  {data.delta > 0 ? "+" : ""}{data.delta.toFixed(1)}pp
                                </span>
                                <span className="text-muted-foreground">({data.total})</span>
                              </div>
                            </div>
                          ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Tag Signal Performance */}
                  {factorAnalysis.factor_performance && (factorAnalysis.factor_performance as any).tag_signal && (
                    <Card className="mb-3">
                      <CardContent className="pt-4 space-y-2">
                        <h3 className="text-sm font-semibold">Signal Tag Performance</h3>
                        <p className="text-[10px] text-muted-foreground">Which reason tags actually predict outcomes?</p>
                        {Object.entries((factorAnalysis.factor_performance as any).tag_signal as Record<string, any>)
                          .filter(([_, v]: [string, any]) => v.total >= 3)
                          .sort(([, a]: [string, any], [, b]: [string, any]) => (b.rate || 0) - (a.rate || 0))
                          .map(([tag, data]: [string, any]) => (
                            <div key={tag} className="flex items-center justify-between">
                              <span className="text-xs truncate max-w-[120px]">{tag}</span>
                              <HitRateBar rate={data.rate} total={data.total} />
                            </div>
                          ))}
                      </CardContent>
                    </Card>
                  )}

                  {/* Factor Predictiveness */}
                  {factorAnalysis.factor_performance && (
                    <Card className="mb-3">
                      <CardContent className="pt-4 space-y-2">
                        <h3 className="text-sm font-semibold">Factor Predictiveness (Bucket Spread)</h3>
                        <p className="text-[10px] text-muted-foreground">Higher spread = more predictive factor</p>
                        {Object.entries(factorAnalysis.factor_performance as Record<string, any>)
                          .filter(([k]) => !["tag_signal", "stat_type", "home_away"].includes(k))
                          .map(([factor, buckets]) => {
                            const entries = Object.entries(buckets as Record<string, any>).filter(([_, v]: [string, any]) => v.total >= 5);
                            if (entries.length < 2) return null;
                            const rates = entries.map(([_, v]: [string, any]) => v.rate || 0);
                            const spread = Math.max(...rates) - Math.min(...rates);
                            return { factor, spread, entries };
                          })
                          .filter(Boolean)
                          .sort((a: any, b: any) => b.spread - a.spread)
                          .map((item: any) => (
                            <div key={item.factor} className="flex items-center justify-between text-xs">
                              <span className="font-medium w-24">{item.factor}</span>
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${item.spread > 15 ? "bg-green-500" : item.spread > 5 ? "bg-yellow-500" : "bg-red-500"}`}
                                    style={{ width: `${Math.min(100, item.spread * 2)}%` }}
                                  />
                                </div>
                                <span className="font-mono">{item.spread.toFixed(1)}pp</span>
                              </div>
                            </div>
                          ))}
                      </CardContent>
                    </Card>
                  )}

                  <p className="text-[10px] text-muted-foreground text-center">
                    Analysis from {factorAnalysis.analysis_date} · {factorAnalysis.sample_size} props · {factorAnalysis.lookback_days}d lookback
                  </p>
                </>
              )}

              {!factorAnalysis && !factorLoading && (
                <p className="text-xs text-muted-foreground text-center py-4">No analysis yet. Click "Run Analysis" to generate insights.</p>
              )}
            </div>

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

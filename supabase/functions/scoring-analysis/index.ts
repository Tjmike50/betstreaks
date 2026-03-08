import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function bucketLabel(score: number | null): string {
  if (score == null) return "N/A";
  if (score >= 70) return "70-100";
  if (score >= 50) return "50-69";
  if (score >= 30) return "30-49";
  return "0-29";
}

function fineGrainBucket(score: number | null): string {
  if (score == null) return "N/A";
  if (score >= 80) return "80-100";
  if (score >= 60) return "60-79";
  if (score >= 40) return "40-59";
  if (score >= 20) return "20-39";
  return "0-19";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const lookbackDays = body.lookback_days || 30;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    // Fetch all graded prop outcomes within lookback
    const { data: props, error: propsErr } = await supabase
      .from("prop_outcomes")
      .select("*")
      .not("hit", "is", null)
      .gte("game_date", cutoffStr)
      .order("game_date", { ascending: false });

    if (propsErr) throw new Error(`Failed to fetch props: ${propsErr.message}`);
    if (!props || props.length === 0) {
      return new Response(
        JSON.stringify({ message: "No graded props in lookback window", sample_size: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === 1. FACTOR PERFORMANCE ANALYSIS ===
    const factorPerf: Record<string, Record<string, { hit: number; total: number; rate?: number }>> = {};

    function trackFactor(factorName: string, bucketName: string, hit: boolean) {
      if (!factorPerf[factorName]) factorPerf[factorName] = {};
      if (!factorPerf[factorName][bucketName]) factorPerf[factorName][bucketName] = { hit: 0, total: 0 };
      factorPerf[factorName][bucketName].total++;
      if (hit) factorPerf[factorName][bucketName].hit++;
    }

    for (const p of props) {
      const hit = p.hit === true;

      // Confidence buckets (fine-grained)
      trackFactor("confidence", fineGrainBucket(p.confidence_score), hit);

      // Value buckets
      trackFactor("value", fineGrainBucket(p.value_score), hit);

      // Volatility buckets
      trackFactor("volatility", fineGrainBucket(p.volatility_score), hit);

      // Consistency buckets
      trackFactor("consistency", fineGrainBucket(p.consistency_score), hit);

      // Stat type
      trackFactor("stat_type", p.stat_type || "unknown", hit);

      // Home/away
      trackFactor("home_away", p.home_away || "unknown", hit);

      // Reason tags analysis
      const tags = Array.isArray(p.reason_tags) ? p.reason_tags : [];
      for (const tag of tags) {
        const t = String(tag);
        if (t.includes("hot_streak")) trackFactor("tag_signal", "hot_streak", hit);
        else if (t.includes("cold_streak")) trackFactor("tag_signal", "cold_streak", hit);
        else if (t.includes("trending_up")) trackFactor("tag_signal", "trending_up", hit);
        else if (t.includes("trending_down")) trackFactor("tag_signal", "trending_down", hit);
        else if (t.includes("consistent")) trackFactor("tag_signal", "consistent", hit);
        else if (t.includes("volatile")) trackFactor("tag_signal", "volatile", hit);
        else if (t.includes("back_to_back")) trackFactor("tag_signal", "back_to_back", hit);
        else if (t.includes("starter")) trackFactor("tag_signal", "starter", hit);
        else if (t.includes("bench")) trackFactor("tag_signal", "bench_role", hit);
        else if (t.includes("large_sample")) trackFactor("tag_signal", "large_sample", hit);
        else if (t.includes("small_sample")) trackFactor("tag_signal", "small_sample", hit);
        else if (t.includes("uncertain_lineup")) trackFactor("tag_signal", "uncertain_lineup", hit);
        else if (t.includes("minutes_trending_up")) trackFactor("tag_signal", "min_trend_up", hit);
        else if (t.includes("minutes_trending_down")) trackFactor("tag_signal", "min_trend_down", hit);
        else if (t.includes("Availability data may be stale")) trackFactor("tag_signal", "stale_avail", hit);
      }
    }

    // Compute rates
    for (const factor of Object.keys(factorPerf)) {
      for (const bucket of Object.keys(factorPerf[factor])) {
        const b = factorPerf[factor][bucket];
        b.rate = b.total > 0 ? Math.round((b.hit / b.total) * 10000) / 100 : 0;
      }
    }

    // === 2. SCORE RANGE PERFORMANCE (10-pt bands) ===
    const scoreRangePerf: Record<string, { hit: number; total: number; rate?: number; avg_actual_delta?: number }> = {};
    for (const p of props) {
      const cs = p.confidence_score;
      if (cs == null) continue;
      const band = `${Math.floor(cs / 10) * 10}-${Math.floor(cs / 10) * 10 + 9}`;
      if (!scoreRangePerf[band]) scoreRangePerf[band] = { hit: 0, total: 0 };
      scoreRangePerf[band].total++;
      if (p.hit) scoreRangePerf[band].hit++;
    }
    for (const band of Object.keys(scoreRangePerf)) {
      const b = scoreRangePerf[band];
      b.rate = b.total > 0 ? Math.round((b.hit / b.total) * 10000) / 100 : 0;
    }

    // === 3. OVERSTATEMENT ANALYSIS ===
    // Where does confidence_score predict better than reality?
    const overstatement: Record<string, { predicted_bucket: string; actual_rate: number; total: number; delta: number }> = {};
    const confBuckets = ["0-19", "20-39", "40-59", "60-79", "80-100"];
    const expectedRanges: Record<string, number> = { "0-19": 10, "20-39": 30, "40-59": 50, "60-79": 70, "80-100": 90 };

    for (const bucket of confBuckets) {
      const bp = factorPerf["confidence"]?.[bucket];
      if (!bp || bp.total < 5) continue;
      const expected = expectedRanges[bucket];
      const actual = bp.rate!;
      overstatement[bucket] = {
        predicted_bucket: bucket,
        actual_rate: actual,
        total: bp.total,
        delta: Math.round((actual - expected) * 100) / 100,
      };
    }

    // === 4. RECOMMENDATIONS ===
    const recommendations: { type: string; factor: string; detail: string; priority: string }[] = [];

    // Find strongest and weakest tag signals
    const tagSignals = factorPerf["tag_signal"] || {};
    const sortedTags = Object.entries(tagSignals)
      .filter(([_, v]) => v.total >= 5)
      .map(([tag, v]) => ({ tag, rate: v.rate!, total: v.total }))
      .sort((a, b) => b.rate - a.rate);

    if (sortedTags.length > 0) {
      const best = sortedTags[0];
      recommendations.push({
        type: "strongest_signal",
        factor: best.tag,
        detail: `${best.rate}% hit rate (${best.total} props)`,
        priority: "info",
      });
      const worst = sortedTags[sortedTags.length - 1];
      recommendations.push({
        type: "weakest_signal",
        factor: worst.tag,
        detail: `${worst.rate}% hit rate (${worst.total} props)`,
        priority: worst.rate < 35 ? "high" : "medium",
      });
    }

    // Check for confidence overstatement
    for (const [bucket, analysis] of Object.entries(overstatement)) {
      if (analysis.delta < -15 && analysis.total >= 10) {
        recommendations.push({
          type: "overstatement",
          factor: `confidence_${bucket}`,
          detail: `Confidence ${bucket} scores hit at ${analysis.actual_rate}% (expected ~${expectedRanges[bucket]}%), overstated by ${Math.abs(analysis.delta).toFixed(1)}pp`,
          priority: "high",
        });
      }
    }

    // Check stat type variance
    const statPerf = factorPerf["stat_type"] || {};
    const statEntries = Object.entries(statPerf).filter(([_, v]) => v.total >= 10);
    if (statEntries.length >= 2) {
      const rates = statEntries.map(([s, v]) => ({ stat: s, rate: v.rate!, total: v.total }));
      rates.sort((a, b) => b.rate - a.rate);
      const spread = rates[0].rate - rates[rates.length - 1].rate;
      if (spread > 15) {
        recommendations.push({
          type: "stat_variance",
          factor: "stat_type",
          detail: `${rates[0].stat} (${rates[0].rate}%) outperforms ${rates[rates.length - 1].stat} (${rates[rates.length - 1].rate}%) by ${spread.toFixed(1)}pp — consider stat-specific weight adjustment`,
          priority: "medium",
        });
      }
    }

    // Weight recommendations based on factor predictiveness
    const factorCorrelation: { factor: string; spread: number }[] = [];
    for (const [factor, buckets] of Object.entries(factorPerf)) {
      if (factor === "tag_signal" || factor === "stat_type" || factor === "home_away") continue;
      const entries = Object.entries(buckets).filter(([_, v]) => v.total >= 5);
      if (entries.length < 2) continue;
      const rates = entries.map(([_, v]) => v.rate!);
      const spread = Math.max(...rates) - Math.min(...rates);
      factorCorrelation.push({ factor, spread });
    }
    factorCorrelation.sort((a, b) => b.spread - a.spread);

    if (factorCorrelation.length >= 2) {
      const strongest = factorCorrelation[0];
      const weakest = factorCorrelation[factorCorrelation.length - 1];
      if (strongest.spread > 20) {
        recommendations.push({
          type: "weight_increase",
          factor: strongest.factor,
          detail: `${strongest.factor} shows ${strongest.spread.toFixed(1)}pp spread between buckets — most predictive factor, consider increasing weight`,
          priority: "medium",
        });
      }
      if (weakest.spread < 5) {
        recommendations.push({
          type: "weight_decrease",
          factor: weakest.factor,
          detail: `${weakest.factor} shows only ${weakest.spread.toFixed(1)}pp spread — least predictive, consider reducing weight`,
          priority: "low",
        });
      }
    }

    // === 5. SAVE SNAPSHOT ===
    const snapshot = {
      analysis_date: new Date().toISOString().split("T")[0],
      lookback_days: lookbackDays,
      sample_size: props.length,
      factor_performance: factorPerf,
      score_range_performance: scoreRangePerf,
      overstatement_analysis: overstatement,
      recommendations,
    };

    const { error: upsertErr } = await supabase
      .from("factor_analysis_snapshots")
      .upsert(snapshot, { onConflict: "analysis_date,lookback_days" });

    if (upsertErr) console.error("Snapshot upsert error:", upsertErr);

    return new Response(
      JSON.stringify({
        ...snapshot,
        saved: !upsertErr,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("scoring-analysis error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

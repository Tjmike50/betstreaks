// ============================================================
// BetStreaks — MLB Anchor Scoring v2
//
// Scores 3 anchor MLB props for the slate of the requested
// game_date and writes results into the shared player_prop_scores
// table (sport='MLB'):
//
//   • HITS                (batter)
//   • TOTAL_BASES         (batter)
//   • STRIKEOUTS          (pitcher)
//
// Design goals
//   1. Reuse multi-sport scoring contract (player_prop_scores).
//   2. Read only from MLB tables already created.
//   3. Keep the scorer deterministic and explainable; no black-box ML.
//   4. Be safe when data is missing — every axis falls back to
//      a neutral 50 so "no data" never produces a confident pick.
//   5. Per-prop weight profiles remain explicit and auditable.
//
// What this function does:
//   - Reads line_snapshots for the date filtered by MLB markets.
//   - Joins each snapshot to:
//       mlb_player_prop_rolling_stats  → recent form / consistency
//       mlb_hitter_game_logs (last 15) → opportunity (PA / batting order)
//       mlb_pitcher_game_logs (last 5) → opportunity (BF / IP)
//       mlb_pitcher_matchup_summaries  → matchup (vs L/R, allowed avgs)
//       mlb_game_context               → matchup (park, weather stub)
//   - Computes the 7 score axes + overall + tier + summary_json.
//   - Upserts rows into player_prop_scores with sport='MLB'.
//
// What is intentionally still conservative / stubbed in v2:
//   - Park factor / weather adjustments are read but only used
//     when game_context_json contains a numeric `park_factor`
//     or `wind_out_mph` field. Otherwise they no-op.
//   - Lineup confirmation (player_availability) is consulted only
//     to drop OUT players, not to boost confidence.
//   - Odds-line value scoring is still threshold-distance-first;
//     no full implied-probability market model yet.
//
// Entry point: POST /functions/v1/score-mlb-anchors
//   Body: { game_date?: "YYYY-MM-DD" }   (defaults to today ET)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import {
import { requireAdmin } from "../_shared/adminAuth.ts";
  MLB_MARKET_MAP,
  MLB_STAT_KEYS,
  type MlbStatKey,
} from "../_shared/mlbMarketMap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Props in scope (anchors + 4 expansion props) ──
// Anchors: HITS, TOTAL_BASES, STRIKEOUTS.
// Expansion: HOME_RUNS, EARNED_RUNS_ALLOWED, WALKS_ALLOWED, HITS_ALLOWED
//   — same scoring framework, prop-specific matchup + risk weights.
const ANCHOR_KEYS: MlbStatKey[] = [
  "HITS",
  "TOTAL_BASES",
  "STRIKEOUTS",
  "HOME_RUNS",
  "EARNED_RUNS_ALLOWED",
  "WALKS_ALLOWED",
  "HITS_ALLOWED",
];

// ── Per-prop weighting (sums to ~1.0 per prop across positive axes) ──
// risk is subtracted, so its weight is the penalty magnitude.
interface WeightProfile {
  recent_form: number;
  matchup: number;
  opportunity: number;
  consistency: number;
  value: number;
  risk_penalty: number;
}

const WEIGHT_PROFILES: Record<MlbStatKey, WeightProfile> = {
  HITS: {
    recent_form: 0.30,
    matchup: 0.20,
    opportunity: 0.25,
    consistency: 0.15,
    value: 0.10,
    risk_penalty: 0.10,
  },
  TOTAL_BASES: {
    recent_form: 0.28,
    matchup: 0.27,
    opportunity: 0.15,
    consistency: 0.10,
    value: 0.20,
    risk_penalty: 0.18,
  },
  STRIKEOUTS: {
    recent_form: 0.27,
    matchup: 0.27,
    opportunity: 0.21,
    consistency: 0.15,
    value: 0.10,
    risk_penalty: 0.12,
  },
  // Expansion props, scored alongside anchors with prop-specific weights.
  // HOME_RUNS — high variance: prioritize matchup + value, heavy risk penalty.
  HOME_RUNS:           { recent_form: 0.20, matchup: 0.28, opportunity: 0.12, consistency: 0.05, value: 0.25, risk_penalty: 0.30 },
  // EARNED_RUNS_ALLOWED — prioritize matchup + recent form + workload, blow-up penalty.
  EARNED_RUNS_ALLOWED: { recent_form: 0.28, matchup: 0.30, opportunity: 0.20, consistency: 0.12, value: 0.10, risk_penalty: 0.22 },
  // WALKS_ALLOWED — prioritize control trend + opp walk tendency + consistency.
  WALKS_ALLOWED:       { recent_form: 0.32, matchup: 0.22, opportunity: 0.15, consistency: 0.21, value: 0.10, risk_penalty: 0.18 },
  // HITS_ALLOWED — prioritize recent form + workload + opp contact + consistency.
  HITS_ALLOWED:        { recent_form: 0.30, matchup: 0.25, opportunity: 0.18, consistency: 0.17, value: 0.10, risk_penalty: 0.18 },
};

// Neutral fallback for any axis when data is missing.
const NEUTRAL = 50;

// ── Helpers ──
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

function tierFor(overall: number): string {
  if (overall >= 75) return "elite";
  if (overall >= 65) return "strong";
  if (overall >= 55) return "lean";
  return "pass";
}

function todayET(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// ── Axis calculators (each returns 0..100 with 50 = neutral) ──

/**
 * Recent form: blend of L5/L10/L15 averages vs threshold.
 * If avg >= threshold → >50 (overstep). If well below → <50.
 */
function scoreRecentForm(
  rolling: RollingRow | null,
  threshold: number,
): { score: number; note: string } {
  if (!rolling) return { score: NEUTRAL, note: "no rolling stats" };
  const samples: { w: number; avg: number | null }[] = [
    { w: 0.5, avg: rolling.window_l5_avg },
    { w: 0.3, avg: rolling.window_l10_avg },
    { w: 0.2, avg: rolling.window_l15_avg },
  ];
  let weightUsed = 0;
  let blended = 0;
  for (const s of samples) {
    if (s.avg != null) {
      blended += s.w * s.avg;
      weightUsed += s.w;
    }
  }
  if (weightUsed === 0) return { score: NEUTRAL, note: "no rolling avg" };
  const avg = blended / weightUsed;
  // Map ratio (avg / threshold) to a 30..85 score window.
  // ratio 1.0 → 60, 1.25 → 75, 0.75 → 45, 0.5 → 35.
  const ratio = threshold > 0 ? avg / threshold : 1;
  const score = clamp(35 + (ratio - 0.5) * 40);
  return {
    score,
    note: `L5=${round1(rolling.window_l5_avg ?? 0)} L10=${round1(rolling.window_l10_avg ?? 0)} vs ${threshold}`,
  };
}

/**
 * Consistency: prefer rolling.consistency_score (0..100) when present,
 * else derive a soft proxy from L10 hit_rate gap.
 */
function scoreConsistency(rolling: RollingRow | null): { score: number; note: string } {
  if (!rolling) return { score: NEUTRAL, note: "no rolling" };
  if (rolling.consistency_score != null) {
    return { score: clamp(Number(rolling.consistency_score)), note: "rolling.consistency" };
  }
  if (rolling.window_l10_hit_rate != null) {
    // hit_rate 0..1 → 30..85 score.
    return {
      score: clamp(30 + Number(rolling.window_l10_hit_rate) * 55),
      note: `L10 hit_rate=${round1(Number(rolling.window_l10_hit_rate))}`,
    };
  }
  return { score: NEUTRAL, note: "consistency unknown" };
}

/**
 * Risk: inverse of consistency, plus volatility_score boost if present.
 * Higher score = riskier.
 */
function scoreRisk(rolling: RollingRow | null, sampleSize: number): { score: number; note: string } {
  if (!rolling) return { score: NEUTRAL, note: "no rolling" };
  const vol = rolling.volatility_score != null ? clamp(Number(rolling.volatility_score)) : null;
  const cons = rolling.consistency_score != null ? clamp(Number(rolling.consistency_score)) : null;
  let risk = NEUTRAL;
  const notes: string[] = [];
  if (vol != null) {
    risk = vol;
    notes.push(`vol=${round1(vol)}`);
  } else if (cons != null) {
    risk = 100 - cons;
    notes.push(`inv-cons=${round1(risk)}`);
  }
  // Penalize tiny samples.
  if (sampleSize < 5) {
    risk = clamp(risk + 15);
    notes.push(`small-sample(${sampleSize})`);
  }
  return { score: clamp(risk), note: notes.join(" ") || "risk neutral" };
}

/**
 * Opportunity (batter): batting order rank + plate appearances trend over L15.
 * Opportunity (pitcher): batters_faced + innings_pitched trend over L5.
 */
function scoreOpportunityBatter(
  hitterLogs: HitterLog[],
): { score: number; note: string } {
  if (hitterLogs.length === 0) return { score: NEUTRAL, note: "no logs" };
  const recent = hitterLogs.slice(0, 15);
  const paAvg =
    recent.reduce((a, l) => a + (l.plate_appearances ?? l.at_bats ?? 0), 0) /
    Math.max(1, recent.length);
  const orderVals = recent
    .map((l) => l.batting_order)
    .filter((v): v is number => v != null && v > 0);
  const orderAvg = orderVals.length > 0
    ? orderVals.reduce((a, v) => a + v, 0) / orderVals.length
    : null;

  // PA: 4.5 PA → ~70, 3.5 → ~55, 2.5 → ~40.
  const paScore = clamp(20 + paAvg * 11);
  // Lineup spot: 1-2 → 75, 3-5 → 65, 6-9 → 45.
  let orderScore = NEUTRAL;
  if (orderAvg != null) {
    if (orderAvg <= 2.5) orderScore = 75;
    else if (orderAvg <= 5.5) orderScore = 65;
    else orderScore = 45;
  }
  const score = clamp(0.6 * paScore + 0.4 * orderScore);
  return {
    score,
    note: `PA≈${round1(paAvg)} ord≈${orderAvg ? round1(orderAvg) : "?"}`,
  };
}

function scoreOpportunityPitcher(
  pitcherLogs: PitcherLog[],
): { score: number; note: string } {
  if (pitcherLogs.length === 0) return { score: NEUTRAL, note: "no logs" };
  const recent = pitcherLogs.slice(0, 5);
  const ipAvg =
    recent.reduce((a, l) => a + (Number(l.innings_pitched) || 0), 0) /
    Math.max(1, recent.length);
  const bfAvg =
    recent.reduce((a, l) => a + (l.batters_faced ?? 0), 0) /
    Math.max(1, recent.length);
  // 6 IP → ~70, 5 IP → ~60, 4 IP → ~50.
  const ipScore = clamp(20 + ipAvg * 8);
  // 25 BF → ~70, 20 BF → ~55.
  const bfScore = clamp(15 + bfAvg * 2.2);
  const score = clamp(0.5 * ipScore + 0.5 * bfScore);
  return { score, note: `IP≈${round1(ipAvg)} BF≈${round1(bfAvg)}` };
}

interface StrikeoutsContext {
  k_l3_avg: number | null;
  k_l5_avg: number | null;
  k_l10_avg: number | null;
  ip_l3_avg: number | null;
  ip_l5_avg: number | null;
  bf_l3_avg: number | null;
  bf_l5_avg: number | null;
  over_line_l5_rate: number | null;
  over_line_l10_rate: number | null;
  opponent_k_rate: number | null;
}

interface PitcherSideContext {
  stat_l3_avg: number | null;
  stat_l5_avg: number | null;
  stat_l10_avg: number | null;
  ip_l3_avg: number | null;
  ip_l5_avg: number | null;
  bf_l3_avg: number | null;
  bf_l5_avg: number | null;
  over_line_l5_rate: number | null;
  over_line_l10_rate: number | null;
}

function averageLast(
  logs: PitcherLog[],
  count: number,
  getter: (log: PitcherLog) => number | null,
): number | null {
  const values = logs
    .slice(0, count)
    .map(getter)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function overLineRate(
  logs: PitcherLog[],
  count: number,
  threshold: number,
): number | null {
  const values = logs
    .slice(0, count)
    .map((log) => log.strikeouts)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) return null;
  return values.filter((v) => v > threshold).length / values.length;
}

function buildStrikeoutsContext(
  pitcherLogs: PitcherLog[],
  threshold: number,
  oppKRate: number | null,
): StrikeoutsContext {
  return {
    k_l3_avg: averageLast(pitcherLogs, 3, (log) => log.strikeouts),
    k_l5_avg: averageLast(pitcherLogs, 5, (log) => log.strikeouts),
    k_l10_avg: averageLast(pitcherLogs, 10, (log) => log.strikeouts),
    ip_l3_avg: averageLast(pitcherLogs, 3, (log) => {
      const n = Number(log.innings_pitched);
      return Number.isFinite(n) ? n : null;
    }),
    ip_l5_avg: averageLast(pitcherLogs, 5, (log) => {
      const n = Number(log.innings_pitched);
      return Number.isFinite(n) ? n : null;
    }),
    bf_l3_avg: averageLast(pitcherLogs, 3, (log) => log.batters_faced),
    bf_l5_avg: averageLast(pitcherLogs, 5, (log) => log.batters_faced),
    over_line_l5_rate: overLineRate(pitcherLogs, 5, threshold),
    over_line_l10_rate: overLineRate(pitcherLogs, 10, threshold),
    opponent_k_rate: oppKRate,
  };
}

function scoreRecentFormStrikeouts(
  context: StrikeoutsContext,
  rolling: RollingRow | null,
  threshold: number,
): { score: number; note: string } {
  const notes: string[] = [];
  let weighted = 0;
  let weightUsed = 0;

  const avgSamples: Array<{ label: string; value: number | null; weight: number }> = [
    { label: "kL3", value: context.k_l3_avg, weight: 0.30 },
    { label: "kL5", value: context.k_l5_avg, weight: 0.25 },
    { label: "kL10", value: context.k_l10_avg, weight: 0.10 },
    { label: "rollL5", value: rolling?.window_l5_avg ?? null, weight: 0.10 },
    { label: "rollL10", value: rolling?.window_l10_avg ?? null, weight: 0.05 },
  ];
  for (const sample of avgSamples) {
    if (sample.value == null || threshold <= 0) continue;
    const ratio = sample.value / threshold;
    const score = clamp(35 + (ratio - 0.5) * 40);
    weighted += sample.weight * score;
    weightUsed += sample.weight;
    notes.push(`${sample.label}=${round1(sample.value)}`);
  }

  const lineRateSamples: Array<{ label: string; value: number | null; weight: number }> = [
    { label: "overL5", value: context.over_line_l5_rate, weight: 0.10 },
    { label: "overL10", value: context.over_line_l10_rate, weight: 0.05 },
    { label: "rollHitL5", value: rolling?.window_l5_hit_rate ?? null, weight: 0.03 },
    { label: "rollHitL10", value: rolling?.window_l10_hit_rate ?? null, weight: 0.02 },
  ];
  for (const sample of lineRateSamples) {
    if (sample.value == null) continue;
    const score = clamp(25 + sample.value * 70);
    weighted += sample.weight * score;
    weightUsed += sample.weight;
    notes.push(`${sample.label}=${round1(sample.value * 100)}%`);
  }

  if (weightUsed === 0) return { score: NEUTRAL, note: "no strikeout recent form context" };
  return { score: clamp(weighted / weightUsed), note: notes.join(" ") };
}

function scoreOpportunityStrikeouts(
  context: StrikeoutsContext,
): { score: number; note: string } {
  const notes: string[] = [];
  let weighted = 0;
  let weightUsed = 0;

  const ipSamples: Array<{ label: string; value: number | null; weight: number }> = [
    { label: "ipL3", value: context.ip_l3_avg, weight: 0.35 },
    { label: "ipL5", value: context.ip_l5_avg, weight: 0.25 },
  ];
  for (const sample of ipSamples) {
    if (sample.value == null) continue;
    const score = clamp(20 + sample.value * 8);
    weighted += sample.weight * score;
    weightUsed += sample.weight;
    notes.push(`${sample.label}=${round1(sample.value)}`);
  }

  const bfSamples: Array<{ label: string; value: number | null; weight: number }> = [
    { label: "bfL3", value: context.bf_l3_avg, weight: 0.25 },
    { label: "bfL5", value: context.bf_l5_avg, weight: 0.15 },
  ];
  for (const sample of bfSamples) {
    if (sample.value == null) continue;
    const score = clamp(15 + sample.value * 2.2);
    weighted += sample.weight * score;
    weightUsed += sample.weight;
    notes.push(`${sample.label}=${round1(sample.value)}`);
  }

  if (weightUsed === 0) return { score: NEUTRAL, note: "no strikeout workload context" };
  return { score: clamp(weighted / weightUsed), note: notes.join(" ") };
}

function buildPitcherSideContext(
  pitcherLogs: PitcherLog[],
  threshold: number,
  getter: (log: PitcherLog) => number | null,
): PitcherSideContext {
  return {
    stat_l3_avg: averageLast(pitcherLogs, 3, getter),
    stat_l5_avg: averageLast(pitcherLogs, 5, getter),
    stat_l10_avg: averageLast(pitcherLogs, 10, getter),
    ip_l3_avg: averageLast(pitcherLogs, 3, (log) => {
      const n = Number(log.innings_pitched);
      return Number.isFinite(n) ? n : null;
    }),
    ip_l5_avg: averageLast(pitcherLogs, 5, (log) => {
      const n = Number(log.innings_pitched);
      return Number.isFinite(n) ? n : null;
    }),
    bf_l3_avg: averageLast(pitcherLogs, 3, (log) => log.batters_faced),
    bf_l5_avg: averageLast(pitcherLogs, 5, (log) => log.batters_faced),
    over_line_l5_rate: overLineRateByValueGetter(pitcherLogs, 5, threshold, getter),
    over_line_l10_rate: overLineRateByValueGetter(pitcherLogs, 10, threshold, getter),
  };
}

function overLineRateByValueGetter(
  logs: PitcherLog[],
  count: number,
  threshold: number,
  getter: (log: PitcherLog) => number | null,
): number | null {
  const values = logs
    .slice(0, count)
    .map(getter)
    .filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length === 0) return null;
  return values.filter((v) => v > threshold).length / values.length;
}

function scoreRecentFormPitcherSide(
  context: PitcherSideContext,
  rolling: RollingRow | null,
  threshold: number,
  labelPrefix: string,
): { score: number; note: string } {
  const notes: string[] = [];
  let weighted = 0;
  let weightUsed = 0;

  const avgSamples: Array<{ label: string; value: number | null; weight: number }> = [
    { label: `${labelPrefix}L3`, value: context.stat_l3_avg, weight: 0.30 },
    { label: `${labelPrefix}L5`, value: context.stat_l5_avg, weight: 0.25 },
    { label: `${labelPrefix}L10`, value: context.stat_l10_avg, weight: 0.10 },
    { label: "rollL5", value: rolling?.window_l5_avg ?? null, weight: 0.10 },
    { label: "rollL10", value: rolling?.window_l10_avg ?? null, weight: 0.05 },
  ];
  for (const sample of avgSamples) {
    if (sample.value == null || threshold <= 0) continue;
    const ratio = sample.value / threshold;
    const score = clamp(35 + (ratio - 0.5) * 40);
    weighted += sample.weight * score;
    weightUsed += sample.weight;
    notes.push(`${sample.label}=${round1(sample.value)}`);
  }

  const lineRateSamples: Array<{ label: string; value: number | null; weight: number }> = [
    { label: "overL5", value: context.over_line_l5_rate, weight: 0.10 },
    { label: "overL10", value: context.over_line_l10_rate, weight: 0.05 },
    { label: "rollHitL5", value: rolling?.window_l5_hit_rate ?? null, weight: 0.03 },
    { label: "rollHitL10", value: rolling?.window_l10_hit_rate ?? null, weight: 0.02 },
  ];
  for (const sample of lineRateSamples) {
    if (sample.value == null) continue;
    const score = clamp(25 + sample.value * 70);
    weighted += sample.weight * score;
    weightUsed += sample.weight;
    notes.push(`${sample.label}=${round1(sample.value * 100)}%`);
  }

  if (weightUsed === 0) return { score: NEUTRAL, note: "no pitcher-side recent form context" };
  return { score: clamp(weighted / weightUsed), note: notes.join(" ") };
}

function scoreOpportunityPitcherSide(
  context: PitcherSideContext,
): { score: number; note: string } {
  const strikeoutLikeContext: StrikeoutsContext = {
    k_l3_avg: context.stat_l3_avg,
    k_l5_avg: context.stat_l5_avg,
    k_l10_avg: context.stat_l10_avg,
    ip_l3_avg: context.ip_l3_avg,
    ip_l5_avg: context.ip_l5_avg,
    bf_l3_avg: context.bf_l3_avg,
    bf_l5_avg: context.bf_l5_avg,
    over_line_l5_rate: context.over_line_l5_rate,
    over_line_l10_rate: context.over_line_l10_rate,
    opponent_k_rate: null,
  };
  const scored = scoreOpportunityStrikeouts(strikeoutLikeContext);
  return {
    score: scored.score,
    note: scored.note === "no strikeout workload context" ? "no pitcher workload context" : scored.note,
  };
}

/**
 * Matchup (batter HITS / TOTAL_BASES):
 *   Use opposing pitcher's hits_allowed_avg / earned_runs_allowed_avg vs league-ish baseline.
 *   Without true splits we keep this directional and capped.
 */
function scoreMatchupBatter(
  pitcherSummary: PitcherMatchup | null,
  ctx: MlbGameContext | null,
  stat: "HITS" | "TOTAL_BASES",
): { score: number; note: string } {
  let score = NEUTRAL;
  const notes: string[] = [];
  if (pitcherSummary) {
    const allowed = stat === "HITS"
      ? pitcherSummary.hits_allowed_avg
      : pitcherSummary.earned_runs_allowed_avg; // proxy: ER ↔ extra-base damage
    if (allowed != null) {
      // Higher allowed = better matchup for batter.
      // hits_allowed 7→60, 9→70, 5→45.
      const baseline = stat === "HITS" ? 7 : 3;
      score = clamp(50 + (Number(allowed) - baseline) * 6);
      notes.push(`${stat === "HITS" ? "H" : "ER"}-allowed=${round1(Number(allowed))}`);
    }
  } else {
    notes.push("no pitcher matchup");
  }
  // Park factor stub: only applied if game_context_json has numeric park_factor.
  const pf = ctx?.game_context_json?.park_factor;
  if (typeof pf === "number" && Number.isFinite(pf)) {
    score = clamp(score + (pf - 1) * 20);
    notes.push(`park=${round1(pf)}`);
  }
  return { score, note: notes.join(" ") || "matchup neutral" };
}

/**
 * Matchup (pitcher STRIKEOUTS):
 *   Use opposing team strikeout_rate from mlb_team_offense_daily.
 *   Higher K-rate = better matchup for the pitcher.
 */
function scoreMatchupPitcher(
  oppKRate: number | null,
  ctx: MlbGameContext | null,
): { score: number; note: string } {
  let score = NEUTRAL;
  const notes: string[] = [];
  if (oppKRate != null) {
    // Typical league K-rate ≈ 0.22; 0.27 → 70, 0.18 → 35.
    score = clamp(50 + (oppKRate - 0.22) * 400);
    notes.push(`oppK=${round1(oppKRate * 100)}%`);
  } else {
    notes.push("no opp K-rate");
  }
  // Wind / park stub for K props is minor; only apply if numeric.
  const pf = ctx?.game_context_json?.park_factor;
  if (typeof pf === "number" && Number.isFinite(pf)) {
    // Pitcher-friendly park (pf<1) slightly boosts K projection.
    score = clamp(score + (1 - pf) * 10);
    notes.push(`park=${round1(pf)}`);
  }
  return { score, note: notes.join(" ") || "matchup neutral" };
}

/**
 * Matchup (batter HOME_RUNS):
 *   Use opposing pitcher's home_runs_allowed_avg + park factor.
 *   Higher allowed HR = better matchup. v1 baseline ≈ 1.0 HR allowed/start.
 */
function scoreMatchupHomeRun(
  pitcherSummary: PitcherMatchup | null,
  oppTeamOff: TeamOffenseRow | null,
  ctx: MlbGameContext | null,
): { score: number; note: string } {
  let score = NEUTRAL;
  const notes: string[] = [];
  if (pitcherSummary?.home_runs_allowed_avg != null) {
    const hra = Number(pitcherSummary.home_runs_allowed_avg);
    // 0.6→40, 1.0→55, 1.4→70, 1.8→85.
    score = clamp(40 + (hra - 0.6) * 37.5);
    notes.push(`HRa=${round1(hra)}`);
  } else if (oppTeamOff?.isolated_power != null) {
    // Fall back to opponent ISO as a coarse power proxy (high ISO ≈ HR threat).
    const iso = Number(oppTeamOff.isolated_power);
    score = clamp(40 + (iso - 0.14) * 250);
    notes.push(`oppISO=${round1(iso * 1000) / 1000}`);
  } else {
    notes.push("no HR matchup data");
  }
  // Park factor: HR-friendly parks boost the score significantly.
  const pf = ctx?.game_context_json?.park_factor;
  if (typeof pf === "number" && Number.isFinite(pf)) {
    score = clamp(score + (pf - 1) * 30);
    notes.push(`park=${round1(pf)}`);
  }
  return { score, note: notes.join(" ") || "HR matchup neutral" };
}

/**
 * Matchup (pitcher WALKS_ALLOWED):
 *   Use opposing team walk_rate. Higher BB-rate = MORE walks allowed
 *   = a better Over for this prop, and a worse Under.
 *   Score reflects "expected walks allowed", so high = leans Over.
 */
function scoreMatchupWalksAllowed(
  oppTeamOff: TeamOffenseRow | null,
  pitcherSummary: PitcherMatchup | null,
): { score: number; note: string } {
  let score = NEUTRAL;
  const notes: string[] = [];
  if (oppTeamOff?.walk_rate != null) {
    const bbRate = Number(oppTeamOff.walk_rate);
    // League BB-rate ≈ 0.085. 0.11 → 70, 0.06 → 35.
    score = clamp(50 + (bbRate - 0.085) * 600);
    notes.push(`oppBB=${round1(bbRate * 100)}%`);
  } else if (pitcherSummary?.walks_allowed_avg != null) {
    // Fall back to pitcher's own recent BB-allowed average.
    const bb = Number(pitcherSummary.walks_allowed_avg);
    score = clamp(35 + bb * 12);
    notes.push(`pBB=${round1(bb)}`);
  } else {
    notes.push("no BB matchup data");
  }
  return { score, note: notes.join(" ") || "BB matchup neutral" };
}

/**
 * Matchup (pitcher HITS_ALLOWED):
 *   Use opposing team OPS / hits_per_game as contact proxy.
 *   Higher = MORE hits allowed expected.
 */
function scoreMatchupHitsAllowed(
  oppTeamOff: TeamOffenseRow | null,
  pitcherSummary: PitcherMatchup | null,
): { score: number; note: string } {
  let score = NEUTRAL;
  const notes: string[] = [];
  if (oppTeamOff?.hits_per_game != null) {
    const hpg = Number(oppTeamOff.hits_per_game);
    // League ≈ 8.3 hits/game. 9.5 → 65, 7.0 → 35.
    score = clamp(50 + (hpg - 8.3) * 12);
    notes.push(`oppHpG=${round1(hpg)}`);
  } else if (pitcherSummary?.hits_allowed_avg != null) {
    const ha = Number(pitcherSummary.hits_allowed_avg);
    score = clamp(35 + ha * 4);
    notes.push(`pHa=${round1(ha)}`);
  } else {
    notes.push("no H matchup data");
  }
  return { score, note: notes.join(" ") || "H matchup neutral" };
}

/**
 * Matchup (pitcher EARNED_RUNS_ALLOWED):
 *   Blend opposing team OPS + runs_per_game as run-scoring proxy.
 *   Higher = MORE ER expected from this pitcher.
 */
function scoreMatchupEarnedRuns(
  oppTeamOff: TeamOffenseRow | null,
  pitcherSummary: PitcherMatchup | null,
  ctx: MlbGameContext | null,
): { score: number; note: string } {
  let score = NEUTRAL;
  const notes: string[] = [];
  if (oppTeamOff?.runs_per_game != null) {
    const rpg = Number(oppTeamOff.runs_per_game);
    // League ≈ 4.5 R/G. 5.5 → 65, 3.5 → 35.
    score = clamp(50 + (rpg - 4.5) * 15);
    notes.push(`oppRpG=${round1(rpg)}`);
    if (oppTeamOff.ops != null) {
      // Light OPS nudge ±10.
      const ops = Number(oppTeamOff.ops);
      score = clamp(score + (ops - 0.72) * 30);
      notes.push(`oppOPS=${round1(ops * 1000) / 1000}`);
    }
  } else if (pitcherSummary?.earned_runs_allowed_avg != null) {
    const er = Number(pitcherSummary.earned_runs_allowed_avg);
    score = clamp(35 + er * 10);
    notes.push(`pER=${round1(er)}`);
  } else {
    notes.push("no ER matchup data");
  }
  // Hitter-friendly parks raise expected ER.
  const pf = ctx?.game_context_json?.park_factor;
  if (typeof pf === "number" && Number.isFinite(pf)) {
    score = clamp(score + (pf - 1) * 15);
    notes.push(`park=${round1(pf)}`);
  }
  return { score, note: notes.join(" ") || "ER matchup neutral" };
}

/**
 * Value: how far the rolling mean projection sits from the threshold.
 * Larger overstep / understep → higher value. Symmetric for v1.
 */
function scoreValue(
  rolling: RollingRow | null,
  threshold: number,
): { score: number; note: string } {
  if (!rolling || rolling.window_l10_avg == null || threshold <= 0) {
    return { score: NEUTRAL, note: "no value math" };
  }
  const avg = Number(rolling.window_l10_avg);
  const gapPct = Math.abs(avg - threshold) / threshold;
  // 0% gap → 45, 25% gap → 70, 50% → 85.
  const score = clamp(45 + gapPct * 80);
  return { score, note: `gap=${round1(gapPct * 100)}%` };
}

function incrementCount(counter: Record<string, number>, key: string, by = 1): void {
  counter[key] = (counter[key] || 0) + by;
}

function pushUniqueTag(tags: string[], tag: string): void {
  if (!tags.includes(tag)) tags.push(tag);
}

function averageDefined(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function weightedAverageScore(parts: Array<{ score: number | null | undefined; weight: number }>): number | null {
  let total = 0;
  let weightUsed = 0;
  for (const part of parts) {
    if (part.score == null || !Number.isFinite(part.score) || part.weight <= 0) continue;
    total += part.score * part.weight;
    weightUsed += part.weight;
  }
  if (weightUsed === 0) return null;
  return clamp(total / weightUsed);
}

function scoreThresholdEdge(
  threshold: number,
  averages: Array<{ label: string; value: number | null; weight: number }>,
  hitRates: Array<{ label: string; value: number | null; weight: number }>,
): { score: number; note: string; hasContext: boolean } {
  const notes: string[] = [];
  const parts: Array<{ score: number; weight: number }> = [];

  for (const sample of averages) {
    if (sample.value == null || threshold <= 0) continue;
    const ratio = sample.value / threshold;
    const sampleScore = clamp(34 + (ratio - 0.55) * 44);
    parts.push({ score: sampleScore, weight: sample.weight });
    notes.push(`${sample.label}=${round1(sample.value)}`);
  }

  for (const sample of hitRates) {
    if (sample.value == null) continue;
    const sampleScore = clamp(28 + sample.value * 68);
    parts.push({ score: sampleScore, weight: sample.weight });
    notes.push(`${sample.label}=${round1(sample.value * 100)}%`);
  }

  const score = weightedAverageScore(parts);
  if (score == null) {
    return { score: NEUTRAL, note: "threshold edge neutral", hasContext: false };
  }
  return { score, note: notes.join(" "), hasContext: true };
}

function scorePitcherWorkloadTrend(
  ipL3: number | null,
  ipL5: number | null,
  bfL3: number | null,
  bfL5: number | null,
): { score: number; note: string; hasContext: boolean } {
  const ipAvg = averageDefined([ipL3, ipL5]);
  const bfAvg = averageDefined([bfL3, bfL5]);
  if (ipAvg == null && bfAvg == null) {
    return { score: NEUTRAL, note: "pitcher workload neutral", hasContext: false };
  }
  const ipScore = ipAvg != null ? clamp(22 + ipAvg * 8) : null;
  const bfScore = bfAvg != null ? clamp(18 + bfAvg * 2.15) : null;
  const score = weightedAverageScore([
    { score: ipScore, weight: 0.55 },
    { score: bfScore, weight: 0.45 },
  ]) ?? NEUTRAL;
  const notes: string[] = [];
  if (ipAvg != null) notes.push(`ip≈${round1(ipAvg)}`);
  if (bfAvg != null) notes.push(`bf≈${round1(bfAvg)}`);
  return { score, note: notes.join(" "), hasContext: true };
}

function adjustForParkWeather(
  baseScore: number,
  ctx: MlbGameContext | null,
  mode: "hitter_contact" | "hitter_power" | "pitcher_contact_allowed" | "pitcher_runs_allowed" | "pitcher_strikeouts",
): { score: number; note: string; usedPark: boolean; usedWeather: boolean } {
  let score = baseScore;
  const notes: string[] = [];
  let usedPark = false;
  let usedWeather = false;
  const parkFactor = ctx?.game_context_json?.park_factor;
  const windOutMph = ctx?.game_context_json?.wind_out_mph;

  if (typeof parkFactor === "number" && Number.isFinite(parkFactor)) {
    usedPark = true;
    const delta =
      mode === "pitcher_strikeouts"
        ? (1 - parkFactor) * 10
        : mode === "pitcher_contact_allowed" || mode === "pitcher_runs_allowed"
        ? (parkFactor - 1) * 16
        : mode === "hitter_power"
        ? (parkFactor - 1) * 24
        : (parkFactor - 1) * 14;
    score = clamp(score + delta);
    notes.push(`park=${round1(parkFactor)}`);
  }

  if (typeof windOutMph === "number" && Number.isFinite(windOutMph)) {
    usedWeather = true;
    const cappedWind = Math.max(-12, Math.min(12, windOutMph));
    const delta =
      mode === "pitcher_runs_allowed"
        ? cappedWind * 0.6
        : mode === "pitcher_contact_allowed"
        ? cappedWind * 0.35
        : mode === "hitter_power"
        ? cappedWind * 0.75
        : mode === "hitter_contact"
        ? cappedWind * 0.25
        : cappedWind * -0.15;
    score = clamp(score + delta);
    notes.push(`wind=${round1(cappedWind)}`);
  }

  return {
    score,
    note: notes.join(" "),
    usedPark,
    usedWeather,
  };
}

function applyConservativeConfidenceCap(
  statKey: MlbStatKey,
  overall: number,
  missingCriticalContexts: string[],
  riskScore: number,
  lineQualityTier?: LineQualityMetrics["line_quality_tier"] | null,
): { score: number; capped: boolean; reason: string | null } {
  let cap: number | null = null;
  if (missingCriticalContexts.length >= 3) cap = 62;
  else if (missingCriticalContexts.length >= 2) cap = 68;
  else if (missingCriticalContexts.length === 1 && lineQualityTier === "weak") cap = 71;

  if ((statKey === "HOME_RUNS" || statKey === "WALKS_ALLOWED") && riskScore >= 70) {
    cap = cap == null ? 69 : Math.min(cap, 69);
  }
  if ((statKey === "EARNED_RUNS_ALLOWED" || statKey === "HITS_ALLOWED") && riskScore >= 72) {
    cap = cap == null ? 70 : Math.min(cap, 70);
  }

  if (cap != null && overall > cap) {
    return {
      score: cap,
      capped: true,
      reason: `missing:${missingCriticalContexts.join(",")}${lineQualityTier ? ` line:${lineQualityTier}` : ""}`,
    };
  }
  return { score: overall, capped: false, reason: null };
}

// ── Types for the data we read ──
interface RollingRow {
  player_id: number;
  market_type_key: string;
  window_l5_avg: number | null;
  window_l10_avg: number | null;
  window_l15_avg: number | null;
  window_l5_hit_rate: number | null;
  window_l10_hit_rate: number | null;
  window_l15_hit_rate: number | null;
  consistency_score: number | null;
  volatility_score: number | null;
  sample_size: number;
}

interface HitterLog {
  player_id: number;
  game_date: string;
  plate_appearances: number | null;
  at_bats: number | null;
  batting_order: number | null;
  opponent_team_id: number | null;
}

interface PitcherLog {
  player_id: number;
  game_date: string;
  innings_pitched: number | string | null;
  batters_faced: number | null;
  strikeouts: number | null;
  walks_allowed?: number | null;
  hits_allowed?: number | null;
  earned_runs_allowed?: number | null;
  opponent_team_id: number | null;
}

interface PitcherMatchup {
  pitcher_id: number;
  hits_allowed_avg: number | null;
  earned_runs_allowed_avg: number | null;
  strikeouts_avg: number | null;
  walks_allowed_avg: number | null;
  home_runs_allowed_avg: number | null;
}

interface TeamOffenseRow {
  team_id: number;
  strikeout_rate: number | null;
  walk_rate: number | null;
  runs_per_game: number | null;
  hits_per_game: number | null;
  isolated_power: number | null;
  ops: number | null;
}

interface MlbGameContext {
  game_id: string;
  probable_home_pitcher_id: number | null;
  probable_away_pitcher_id: number | null;
  game_context_json: Record<string, unknown> | null;
}

interface LineSnapshot {
  player_id: number | null;
  player_name: string;
  stat_type: string;       // The Odds API market key, e.g. "batter_hits"
  threshold: number;
  game_date: string;
  over_odds: string | null;
  under_odds: string | null;
  sportsbook?: string;
  snapshot_at?: string;
}

interface LineQualityMetrics {
  book_count: number;
  best_over_price: number | null;
  best_under_price: number | null;
  average_over_price: number | null;
  line_spread: number;
  consensus_threshold: number | null;
  threshold_is_consensus: boolean;
  odds_freshness_minutes: number | null;
  line_quality_score: number;
  line_quality_tier: "elite" | "strong" | "lean" | "weak";
  has_price_data: boolean;
}

function parseAmericanOdds(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function lineQualityTier(score: number): "elite" | "strong" | "lean" | "weak" {
  if (score >= 75) return "elite";
  if (score >= 60) return "strong";
  if (score >= 45) return "lean";
  return "weak";
}

function lineQualityAdjustment(tier: ReturnType<typeof lineQualityTier>): number {
  switch (tier) {
    case "elite":
      return 3;
    case "strong":
      return 1.5;
    case "lean":
      return 0;
    case "weak":
    default:
      return -4;
  }
}

function computeLineQualityMetrics(
  rows: Array<LineSnapshot & { sportsbook: string; snapshot_at: string }>,
  threshold: number,
): LineQualityMetrics {
  const thresholds = [...new Set(rows.map((row) => Number(row.threshold)).filter((v) => Number.isFinite(v)))];
  const thresholdRows = rows.filter((row) => Number(row.threshold) === Number(threshold));
  const uniqueBooks = new Set(thresholdRows.map((row) => row.sportsbook).filter(Boolean));
  const overPrices = thresholdRows
    .map((row) => parseAmericanOdds(row.over_odds))
    .filter((v): v is number => v != null);
  const underPrices = thresholdRows
    .map((row) => parseAmericanOdds(row.under_odds))
    .filter((v): v is number => v != null);

  const thresholdCounts = new Map<number, Set<string>>();
  for (const row of rows) {
    const t = Number(row.threshold);
    if (!Number.isFinite(t)) continue;
    const set = thresholdCounts.get(t) ?? new Set<string>();
    if (row.sportsbook) set.add(row.sportsbook);
    thresholdCounts.set(t, set);
  }
  const consensusEntry = [...thresholdCounts.entries()].sort((a, b) => {
    const countDelta = b[1].size - a[1].size;
    if (countDelta !== 0) return countDelta;
    return a[0] - b[0];
  })[0];
  const consensusThreshold = consensusEntry ? consensusEntry[0] : null;

  const freshest = rows
    .map((row) => new Date(row.snapshot_at).getTime())
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a)[0];
  const freshnessMinutes = freshest != null ? Math.max(0, (Date.now() - freshest) / 60_000) : null;

  let score = 50;
  const bookCount = uniqueBooks.size;
  if (bookCount >= 5) score += 18;
  else if (bookCount >= 3) score += 12;
  else if (bookCount === 2) score += 4;
  else if (bookCount === 1) score -= 4;

  if (consensusThreshold != null && Number(threshold) === consensusThreshold) score += 10;
  else score -= 5;

  const spread = thresholds.length > 0 ? Math.max(...thresholds) - Math.min(...thresholds) : 0;
  if (spread >= 1.5) score -= 16;
  else if (spread >= 1) score -= 10;
  else if (spread >= 0.5) score -= 5;
  else score += 4;

  const hasPriceData = overPrices.length > 0 || underPrices.length > 0;
  if (!hasPriceData) score -= 6;
  else if (overPrices.length > 0 && underPrices.length > 0) score += 3;

  if (freshnessMinutes != null) {
    if (freshnessMinutes <= 10) score += 8;
    else if (freshnessMinutes <= 30) score += 4;
    else if (freshnessMinutes > 120) score -= 15;
    else if (freshnessMinutes > 30) score -= 8;
  } else {
    score -= 5;
  }

  const finalScore = clamp(score);
  return {
    book_count: bookCount,
    best_over_price: overPrices.length > 0 ? Math.max(...overPrices) : null,
    best_under_price: underPrices.length > 0 ? Math.max(...underPrices) : null,
    average_over_price: overPrices.length > 0 ? overPrices.reduce((a, b) => a + b, 0) / overPrices.length : null,
    line_spread: round1(spread),
    consensus_threshold: consensusThreshold,
    threshold_is_consensus: consensusThreshold != null && Number(threshold) === consensusThreshold,
    odds_freshness_minutes: freshnessMinutes != null ? round1(freshnessMinutes) : null,
    line_quality_score: round1(finalScore),
    line_quality_tier: lineQualityTier(finalScore),
    has_price_data: hasPriceData,
  };
}

// ── Main handler ──
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const __auth = await requireAdmin(req);
  if (!__auth.ok) {
    return new Response(JSON.stringify({ error: __auth.error }), {
      status: __auth.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let body: { game_date?: string } = {};
  try {
    body = await req.json();
  } catch (_) { /* allow empty body */ }
  const gameDate = body.game_date || todayET();

  // Build reverse lookup from Odds-API market → MlbStatKey for the 3 anchors.
  const anchorOddsMarkets = ANCHOR_KEYS.map((k) => MLB_MARKET_MAP[k].oddsApiMarket);
  const oddsToStatKey: Record<string, MlbStatKey> = {};
  for (const k of ANCHOR_KEYS) {
    oddsToStatKey[MLB_MARKET_MAP[k].oddsApiMarket] = k;
  }

  // 1) Pull line snapshots for the date, only for the 3 anchor markets.
  //    We scope to "consensus" sportsbook to avoid duplicate per-book rows.
  const { data: snaps, error: snapErr } = await supabase
    .from("line_snapshots")
    .select("player_id,player_name,stat_type,threshold,game_date,over_odds,under_odds,sportsbook,snapshot_at")
    .eq("game_date", gameDate)
    .in("stat_type", anchorOddsMarkets);

  if (snapErr) {
    return new Response(
      JSON.stringify({ ok: false, error: snapErr.message, step: "line_snapshots" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // De-dupe (player, stat_type, threshold) — prefer consensus, then any.
  //
  // PRIMARY PATH: Odds API snapshots arrive with player_id=null. Resolve the
  // sportsbook player_name to a real SportsDataIO PlayerID via
  // mlb_player_profiles (case + diacritic-insensitive). This is what allows
  // rolling stats / hitter logs / pitcher logs to actually JOIN.
  //
  // FALLBACK: If no profile match, synthesize a stable negative bigint id from
  // a hash of player_name so (player_id, stat_type, threshold) upserts remain
  // idempotent. These rows will be neutral/pass (no joinable stats) but won't
  // collide with real positive SportsDataIO ids.
  function normName(name: string): string {
    return name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // strip diacritics
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")    // strip Jr./III/punctuation
      .replace(/\s+/g, " ")
      .trim();
  }
  function synthIdForName(name: string): number {
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return -((h % 2_000_000_000) + 1);
  }

  // Build a name→player_id index from mlb_player_profiles for the names we
  // actually need to resolve. Limit the candidate pool by collecting unique
  // names from snapshots first.
  const snapNames = [
    ...new Set(
      ((snaps ?? []) as Array<{ player_name: string | null }>)
        .map((s) => s?.player_name?.trim())
        .filter((n): n is string => !!n),
    ),
  ];
  const nameToPid = new Map<string, number>();
  if (snapNames.length > 0) {
    // Page through profiles to bypass Supabase's default 1000-row cap
    // (mlb_player_profiles has ~7k active rows). We need ALL of them so
    // sportsbook names with diacritics / punctuation match correctly via
    // the normalized index.
    const PAGE = 1000;
    let from = 0;
    for (let page = 0; page < 20; page++) {
      const { data: nameRows, error: nameErr } = await supabase
        .from("mlb_player_profiles")
        .select("player_id,player_name")
        .not("player_name", "is", null)
        .order("player_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (nameErr) {
        console.error(`[score-mlb-anchors] profile name page ${page} failed: ${nameErr.message}`);
        break;
      }
      const rows = (nameRows ?? []) as Array<{ player_id: number; player_name: string }>;
      for (const r of rows) {
        const k = normName(r.player_name);
        if (k && !nameToPid.has(k)) nameToPid.set(k, Number(r.player_id));
      }
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    console.log(`[score-mlb-anchors] name index built: ${nameToPid.size} entries`);
  }

  let resolvedReal = 0;
  let resolvedSynth = 0;
  const dedup = new Map<string, LineSnapshot>();
  const snapshotGroupsByPlayerMarket = new Map<string, Array<LineSnapshot & { sportsbook: string; snapshot_at: string }>>();
  for (const s of (snaps ?? []) as Array<LineSnapshot & { sportsbook: string }>) {
    if (s.player_id == null && s.player_name) {
      const realPid = nameToPid.get(normName(s.player_name));
      if (realPid && realPid > 0) {
        (s as LineSnapshot).player_id = realPid;
        resolvedReal++;
      } else {
        (s as LineSnapshot).player_id = synthIdForName(s.player_name);
        resolvedSynth++;
      }
    }
    if (s.player_id == null) continue;
    const groupKey = `${s.player_id}|${s.stat_type}`;
    const group = snapshotGroupsByPlayerMarket.get(groupKey) ?? [];
    group.push({
      ...s,
      sportsbook: s.sportsbook,
      snapshot_at: (s as LineSnapshot & { snapshot_at?: string }).snapshot_at ?? new Date(0).toISOString(),
    });
    snapshotGroupsByPlayerMarket.set(groupKey, group);
    const key = `${s.player_id}|${s.stat_type}|${s.threshold}`;
    const existing = dedup.get(key);
    if (!existing || s.sportsbook === "consensus") dedup.set(key, s);
  }
  const lines = [...dedup.values()];
  console.log(
    `[score-mlb-anchors] name-resolution date=${gameDate} snaps=${(snaps ?? []).length} unique_names=${snapNames.length} resolved_real=${resolvedReal} resolved_synth=${resolvedSynth} lines=${lines.length}`,
  );

  if (lines.length === 0) {
    return new Response(
      JSON.stringify({
        ok: true,
        sport: "MLB",
        game_date: gameDate,
        scored_count: 0,
        note: "no MLB anchor lines for date",
        duration_ms: Date.now() - startedAt,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const playerIds = [...new Set(lines.map((l) => l.player_id!))];

  // 2) Pull supporting MLB data in parallel.
  const [
    { data: profiles },
    { data: rollingRows },
    { data: hitterLogs },
    { data: pitcherLogs },
    { data: gamesToday },
    { data: ctxRows },
    { data: teamMapRows },
  ] = await Promise.all([
    supabase
      .from("mlb_player_profiles")
      .select("player_id,mlb_team_id,primary_role,bats,throws")
      .in("player_id", playerIds),
    supabase
      .from("mlb_player_prop_rolling_stats")
      .select(
        "player_id,market_type_key,window_l5_avg,window_l10_avg,window_l15_avg,window_l5_hit_rate,window_l10_hit_rate,window_l15_hit_rate,consistency_score,volatility_score,sample_size,as_of_date",
      )
      .in("player_id", playerIds)
      .lte("as_of_date", gameDate)
      .order("as_of_date", { ascending: false }),
    supabase
      .from("mlb_hitter_game_logs")
      .select("player_id,game_date,plate_appearances,at_bats,batting_order,opponent_team_id")
      .in("player_id", playerIds)
      .lt("game_date", gameDate)
      .order("game_date", { ascending: false })
      .limit(15 * playerIds.length),
    supabase
      .from("mlb_pitcher_game_logs")
      .select("player_id,game_date,innings_pitched,batters_faced,strikeouts,walks_allowed,hits_allowed,earned_runs_allowed,opponent_team_id")
      .in("player_id", playerIds)
      .lt("game_date", gameDate)
      .order("game_date", { ascending: false })
      .limit(10 * playerIds.length),
    supabase.rpc("get_trusted_games_today", {
      p_sport: "MLB",
      p_target_date: gameDate,
      p_timezone: "America/New_York",
    }),
    supabase
      .from("mlb_game_context")
      .select("game_id,probable_home_pitcher_id,probable_away_pitcher_id,game_context_json"),
    supabase
      .from("mlb_team_id_map")
      .select("team_id,team_abbr"),
  ]);

  // Index helpers.
  const profileById = new Map<number, { mlb_team_id: number | null; primary_role: string | null }>();
  for (const p of profiles ?? []) profileById.set(p.player_id, { mlb_team_id: p.mlb_team_id, primary_role: p.primary_role });

  // Latest rolling row per (player, market).
  const rollingByKey = new Map<string, RollingRow>();
  for (const r of (rollingRows ?? []) as RollingRow[]) {
    const k = `${r.player_id}|${r.market_type_key}`;
    if (!rollingByKey.has(k)) rollingByKey.set(k, r);
  }

  const hitterLogsByPlayer = new Map<number, HitterLog[]>();
  for (const l of (hitterLogs ?? []) as HitterLog[]) {
    const arr = hitterLogsByPlayer.get(l.player_id) ?? [];
    if (arr.length < 15) arr.push(l);
    hitterLogsByPlayer.set(l.player_id, arr);
  }

  const pitcherLogsByPlayer = new Map<number, PitcherLog[]>();
  for (const l of (pitcherLogs ?? []) as PitcherLog[]) {
    const arr = pitcherLogsByPlayer.get(l.player_id) ?? [];
    if (arr.length < 10) arr.push(l);
    pitcherLogsByPlayer.set(l.player_id, arr);
  }

  // Today's MLB game ids → context.
  const todaysGameIds = new Set((gamesToday ?? []).map((g) => g.id));
  const ctxByGameId = new Map<string, MlbGameContext>();
  for (const c of (ctxRows ?? []) as MlbGameContext[]) {
    if (todaysGameIds.has(c.game_id)) ctxByGameId.set(c.game_id, c);
  }

  // Build teamId → abbr map and per-team game info from today's games + context.
  // This lets us populate team_abbr / opponent_abbr / home_away on every scored row.
  const teamIdToAbbr = new Map<number, string>();
  for (const row of (teamMapRows ?? []) as Array<{ team_id: number; team_abbr: string }>) {
    if (row.team_id && row.team_abbr) teamIdToAbbr.set(Number(row.team_id), row.team_abbr);
  }
  // teamId → { gameId, homeId, awayId, homeAbbr, awayAbbr }
  const teamGameInfo = new Map<number, { homeId: number; awayId: number; homeAbbr: string; awayAbbr: string }>();
  const gamesByIdMap = new Map<string, { home_team_abbr: string | null; away_team_abbr: string | null }>();
  for (const g of (gamesToday ?? []) as Array<{ id: string; home_team_abbr: string | null; away_team_abbr: string | null }>) {
    gamesByIdMap.set(g.id, g);
  }
  for (const c of ctxByGameId.values()) {
    const g = gamesByIdMap.get(c.game_id);
    if (!g || !g.home_team_abbr || !g.away_team_abbr) continue;
    const ctxJson = c.game_context_json as Record<string, unknown> | null;
    const homeId = Number(ctxJson?.home_team_id);
    const awayId = Number(ctxJson?.away_team_id);
    if (Number.isFinite(homeId) && homeId > 0) {
      teamIdToAbbr.set(homeId, g.home_team_abbr);
      teamGameInfo.set(homeId, { homeId, awayId, homeAbbr: g.home_team_abbr, awayAbbr: g.away_team_abbr });
    }
    if (Number.isFinite(awayId) && awayId > 0) {
      teamIdToAbbr.set(awayId, g.away_team_abbr);
      teamGameInfo.set(awayId, { homeId, awayId, homeAbbr: g.home_team_abbr, awayAbbr: g.away_team_abbr });
    }
  }
  if (teamIdToAbbr.size < 25) {
    console.warn(
      `[score-mlb-anchors] teamIdToAbbr only has ${teamIdToAbbr.size} entries — upstream games_today/mlb_game_context may be incomplete`,
    );
  }

  // Pull pitcher matchup summaries for any probable pitchers we might face.
  const probablePitcherIds = new Set<number>();
  for (const c of ctxByGameId.values()) {
    if (c.probable_home_pitcher_id) probablePitcherIds.add(c.probable_home_pitcher_id);
    if (c.probable_away_pitcher_id) probablePitcherIds.add(c.probable_away_pitcher_id);
  }
  let pitcherMatchupById = new Map<number, PitcherMatchup>();
  if (probablePitcherIds.size > 0) {
    const { data: pms } = await supabase
      .from("mlb_pitcher_matchup_summaries")
      .select(
        "pitcher_id,hits_allowed_avg,earned_runs_allowed_avg,strikeouts_avg,walks_allowed_avg,home_runs_allowed_avg,as_of_date",
      )
      .in("pitcher_id", [...probablePitcherIds])
      .lte("as_of_date", gameDate)
      .order("as_of_date", { ascending: false });
    for (const p of (pms ?? []) as (PitcherMatchup & { as_of_date: string })[]) {
      if (!pitcherMatchupById.has(p.pitcher_id)) {
        pitcherMatchupById.set(p.pitcher_id, p);
      }
    }
  }

  // Opposing-team offense (K-rate, BB-rate, runs, hits, OPS, ISO) for pitcher
  // and HOME_RUNS matchup scoring. We resolve the opposing team via the most
  // recent pitcher_log opponent_team_id, falling back to the batter's profile
  // team for HR matchup.
  const oppTeamIds = new Set<number>();
  for (const log of pitcherLogs ?? []) {
    if (log.opponent_team_id) oppTeamIds.add(log.opponent_team_id);
  }
  // Also include hitter teams so HR matchup can resolve opposing pitcher's team.
  for (const p of profiles ?? []) {
    if (p.mlb_team_id) oppTeamIds.add(p.mlb_team_id);
  }
  const teamOffenseById = new Map<number, TeamOffenseRow>();
  if (oppTeamIds.size > 0) {
    const { data: offRows } = await supabase
      .from("mlb_team_offense_daily")
      .select(
        "team_id,strikeout_rate,walk_rate,runs_per_game,hits_per_game,isolated_power,ops,as_of_date,split_type",
      )
      .in("team_id", [...oppTeamIds])
      .eq("split_type", "overall")
      .lte("as_of_date", gameDate)
      .order("as_of_date", { ascending: false });
    for (const r of (offRows ?? []) as Array<TeamOffenseRow & { as_of_date: string }>) {
      if (!teamOffenseById.has(r.team_id)) {
        teamOffenseById.set(r.team_id, r);
      }
    }
  }

  // 3) Score each line.
  const rowsToUpsert: Record<string, unknown>[] = [];
  let scoredCount = 0;
  let skippedCount = 0;
  let strikeoutsEnhancedCount = 0;
  let strikeoutsMissingContextCount = 0;
  let pitcherSideEnhancedCount = 0;
  let pitcherSideMissingContextCount = 0;
  let lineQualityEnhancedCount = 0;
  let lineQualityMissingCount = 0;
  let lineQualityWeakCount = 0;
  let lineQualityEliteCount = 0;
  let nullTeamAbbrScoreCount = 0;
  const nullTeamAbbrReasons: Record<string, number> = {};
  const contextUsedCounts: Record<string, number> = {};
  const contextMissingCounts: Record<string, number> = {};
  const cappedConfidenceCounts: Record<string, number> = {};
  const fallbackNeutralContextCounts: Record<string, number> = {};
  const weightsAppliedByStatType = Object.fromEntries(
    ANCHOR_KEYS.map((key) => [
      key,
      {
        ...WEIGHT_PROFILES[key],
        v2_adjustments: [
          "threshold_edge_blend",
          "line_quality_value_blend",
          "conservative_missing_context_caps",
        ],
      },
    ]),
  );

  for (const line of lines) {
    const statKey = oddsToStatKey[line.stat_type];
    if (!statKey) { skippedCount++; continue; }
    const profile = profileById.get(line.player_id!);
    const isPitcherProp = MLB_MARKET_MAP[statKey].role === "pitcher";

    const rolling = rollingByKey.get(`${line.player_id}|${statKey}`) ?? null;
    const sampleSize = rolling?.sample_size ?? 0;
    let strikeoutContext: StrikeoutsContext | null = null;
    let strikeoutOpponentOff: TeamOffenseRow | null = null;
    let pitcherSideContext: PitcherSideContext | null = null;
    const extraReasonTags: string[] = [];
    const missingCriticalContexts: string[] = [];

    // Recent form, consistency, risk, value (shared across props).
    const rf = scoreRecentForm(rolling, line.threshold);
    const cs = scoreConsistency(rolling);
    const rk = scoreRisk(rolling, sampleSize);
    const vl = scoreValue(rolling, line.threshold);

    if (rolling) incrementCount(contextUsedCounts, "rolling_stats");
    else {
      incrementCount(contextMissingCounts, "rolling_stats");
      incrementCount(fallbackNeutralContextCounts, "rolling_stats");
      pushUniqueTag(extraReasonTags, "context_missing_neutral");
    }

    // Opportunity + matchup vary by role.
    let opp: { score: number; note: string };
    let mu: { score: number; note: string };

    const rawMarketKey = MLB_MARKET_MAP[statKey].oddsApiMarket;
    const lineQualityRows = snapshotGroupsByPlayerMarket.get(`${line.player_id}|${rawMarketKey}`) ?? [];
    let lineQuality: LineQualityMetrics | null = null;
    if (lineQualityRows.length > 0) {
      lineQuality = computeLineQualityMetrics(lineQualityRows, line.threshold);
      lineQualityEnhancedCount++;
      incrementCount(contextUsedCounts, "line_quality");
      if (lineQuality.line_quality_tier === "weak") lineQualityWeakCount++;
      if (lineQuality.line_quality_tier === "elite") lineQualityEliteCount++;
    } else {
      lineQualityMissingCount++;
      incrementCount(contextMissingCounts, "line_quality");
      incrementCount(fallbackNeutralContextCounts, "line_quality");
      pushUniqueTag(extraReasonTags, "context_missing_neutral");
    }

    if (isPitcherProp) {
      const logs = pitcherLogsByPlayer.get(line.player_id!) ?? [];
      opp = scoreOpportunityPitcher(logs);

      // Find this pitcher's game context today, if any. Resolve opposing team
      // via the most recent log opponent (works for in-season pitchers).
      let oppTeamId: number | null = logs[0]?.opponent_team_id ?? null;
      let pitcherCtx: MlbGameContext | null = null;
      for (const c of ctxByGameId.values()) {
        if (
          c.probable_home_pitcher_id === line.player_id ||
          c.probable_away_pitcher_id === line.player_id
        ) {
          pitcherCtx = c;
          if (oppTeamId == null) oppTeamId = logs[0]?.opponent_team_id ?? null;
          break;
        }
      }
      const oppOff = oppTeamId != null ? teamOffenseById.get(oppTeamId) ?? null : null;
      const ownPitcherMatchup = pitcherMatchupById.get(line.player_id!) ?? null;
      strikeoutOpponentOff = oppOff;

      switch (statKey) {
        case "STRIKEOUTS": {
          strikeoutContext = buildStrikeoutsContext(logs, line.threshold, oppOff?.strikeout_rate ?? null);
          const enhancedRf = scoreRecentFormStrikeouts(strikeoutContext, rolling, line.threshold);
          const enhancedOpp = scoreOpportunityStrikeouts(strikeoutContext);
          const thresholdEdge = scoreThresholdEdge(
            line.threshold,
            [
              { label: "kL3", value: strikeoutContext.k_l3_avg, weight: 0.35 },
              { label: "kL5", value: strikeoutContext.k_l5_avg, weight: 0.35 },
              { label: "kL10", value: strikeoutContext.k_l10_avg, weight: 0.15 },
              { label: "rollL10", value: rolling?.window_l10_avg ?? null, weight: 0.15 },
            ],
            [
              { label: "overL5", value: strikeoutContext.over_line_l5_rate, weight: 0.65 },
              { label: "overL10", value: strikeoutContext.over_line_l10_rate, weight: 0.35 },
            ],
          );
          const workloadScore = scorePitcherWorkloadTrend(
            strikeoutContext.ip_l3_avg,
            strikeoutContext.ip_l5_avg,
            strikeoutContext.bf_l3_avg,
            strikeoutContext.bf_l5_avg,
          );
          rf.score = enhancedRf.score;
          rf.note = enhancedRf.note;
          if (sampleSize < 5) {
            const seasonK = ownPitcherMatchup?.strikeouts_avg != null ? Number(ownPitcherMatchup.strikeouts_avg) : null;
            if (seasonK != null && line.threshold > 0) {
              const ratio = seasonK / line.threshold;
              const seasonScore = clamp(35 + (ratio - 0.5) * 40);
              rf.score = (rf.score + seasonScore) / 2;
              rf.note = `${rf.note} +K-stabilize(season=${round1(seasonK)})`;
            }
          }
          rf.score = weightedAverageScore([
            { score: rf.score, weight: 0.72 },
            { score: thresholdEdge.score, weight: thresholdEdge.hasContext ? 0.28 : 0 },
          ]) ?? rf.score;
          if (thresholdEdge.hasContext) {
            incrementCount(contextUsedCounts, "threshold_edge_strikeouts");
            pushUniqueTag(extraReasonTags, "threshold_edge");
            rf.note = `${rf.note} | edge=${thresholdEdge.note}`;
          } else {
            incrementCount(contextMissingCounts, "threshold_edge_strikeouts");
            incrementCount(fallbackNeutralContextCounts, "threshold_edge_strikeouts");
          }

          opp.score = weightedAverageScore([
            { score: enhancedOpp.score, weight: 0.72 },
            { score: workloadScore.score, weight: workloadScore.hasContext ? 0.28 : 0 },
          ]) ?? enhancedOpp.score;
          opp.note = workloadScore.hasContext ? `${enhancedOpp.note} | workload=${workloadScore.note}` : enhancedOpp.note;

          mu = scoreMatchupPitcher(strikeoutContext.opponent_k_rate, pitcherCtx);
          const parkWeatherAdjustment = adjustForParkWeather(mu.score, pitcherCtx, "pitcher_strikeouts");
          mu.score = parkWeatherAdjustment.score;
          if (parkWeatherAdjustment.note) mu.note = `${mu.note} ${parkWeatherAdjustment.note}`.trim();
          if (parkWeatherAdjustment.usedPark) incrementCount(contextUsedCounts, "park_factor");
          else incrementCount(contextMissingCounts, "park_factor");
          if (parkWeatherAdjustment.usedWeather) incrementCount(contextUsedCounts, "weather");
          else incrementCount(contextMissingCounts, "weather");

          if (workloadScore.hasContext) {
            incrementCount(contextUsedCounts, "pitcher_workload");
            pushUniqueTag(extraReasonTags, "pitcher_workload");
          } else {
            incrementCount(contextMissingCounts, "pitcher_workload");
            incrementCount(fallbackNeutralContextCounts, "pitcher_workload");
            missingCriticalContexts.push("workload");
          }
          if (strikeoutContext.opponent_k_rate != null) incrementCount(contextUsedCounts, "opponent_offense_tendency");
          else {
            incrementCount(contextMissingCounts, "opponent_offense_tendency");
            incrementCount(fallbackNeutralContextCounts, "opponent_offense_tendency");
            missingCriticalContexts.push("opponent_tendency");
          }

          const hasRecentKContext =
            strikeoutContext.k_l5_avg != null ||
            strikeoutContext.k_l10_avg != null ||
            strikeoutContext.over_line_l5_rate != null ||
            strikeoutContext.over_line_l10_rate != null;
          const hasWorkloadContext =
            strikeoutContext.ip_l5_avg != null ||
            strikeoutContext.bf_l5_avg != null;
          const hasOpponentContext = strikeoutContext.opponent_k_rate != null;
          if (hasRecentKContext && hasWorkloadContext && hasOpponentContext) {
            strikeoutsEnhancedCount++;
          } else {
            strikeoutsMissingContextCount++;
          }
          break;
        }
        case "WALKS_ALLOWED":
          pitcherSideContext = buildPitcherSideContext(logs, line.threshold, (log) => log.walks_allowed ?? null);
          {
            const enhancedRf = scoreRecentFormPitcherSide(pitcherSideContext, rolling, line.threshold, "bb");
            const enhancedOpp = scoreOpportunityPitcherSide(pitcherSideContext);
            const thresholdEdge = scoreThresholdEdge(
              line.threshold,
              [
                { label: "bbL3", value: pitcherSideContext.stat_l3_avg, weight: 0.30 },
                { label: "bbL5", value: pitcherSideContext.stat_l5_avg, weight: 0.35 },
                { label: "bbL10", value: pitcherSideContext.stat_l10_avg, weight: 0.15 },
                { label: "rollL10", value: rolling?.window_l10_avg ?? null, weight: 0.20 },
              ],
              [
                { label: "overL5", value: pitcherSideContext.over_line_l5_rate, weight: 0.65 },
                { label: "overL10", value: pitcherSideContext.over_line_l10_rate, weight: 0.35 },
              ],
            );
            const workloadScore = scorePitcherWorkloadTrend(
              pitcherSideContext.ip_l3_avg,
              pitcherSideContext.ip_l5_avg,
              pitcherSideContext.bf_l3_avg,
              pitcherSideContext.bf_l5_avg,
            );
            rf.score = weightedAverageScore([
              { score: enhancedRf.score, weight: 0.7 },
              { score: thresholdEdge.score, weight: thresholdEdge.hasContext ? 0.3 : 0 },
            ]) ?? enhancedRf.score;
            rf.note = thresholdEdge.hasContext ? `${enhancedRf.note} | edge=${thresholdEdge.note}` : enhancedRf.note;
            opp.score = weightedAverageScore([
              { score: enhancedOpp.score, weight: 0.7 },
              { score: workloadScore.score, weight: workloadScore.hasContext ? 0.3 : 0 },
            ]) ?? enhancedOpp.score;
            opp.note = workloadScore.hasContext ? `${enhancedOpp.note} | workload=${workloadScore.note}` : enhancedOpp.note;
            if (thresholdEdge.hasContext) {
              incrementCount(contextUsedCounts, "threshold_edge_walks_allowed");
              pushUniqueTag(extraReasonTags, "threshold_edge");
            } else {
              incrementCount(contextMissingCounts, "threshold_edge_walks_allowed");
              incrementCount(fallbackNeutralContextCounts, "threshold_edge_walks_allowed");
            }
            if (workloadScore.hasContext) {
              incrementCount(contextUsedCounts, "pitcher_workload");
              pushUniqueTag(extraReasonTags, "pitcher_workload");
            } else {
              incrementCount(contextMissingCounts, "pitcher_workload");
              incrementCount(fallbackNeutralContextCounts, "pitcher_workload");
              missingCriticalContexts.push("workload");
            }
          }
          mu = scoreMatchupWalksAllowed(oppOff, ownPitcherMatchup);
          if (oppOff?.walk_rate != null || ownPitcherMatchup?.walks_allowed_avg != null) incrementCount(contextUsedCounts, "opponent_offense_tendency");
          else {
            incrementCount(contextMissingCounts, "opponent_offense_tendency");
            incrementCount(fallbackNeutralContextCounts, "opponent_offense_tendency");
            missingCriticalContexts.push("opponent_tendency");
          }
          if (
            (pitcherSideContext.stat_l5_avg != null || pitcherSideContext.stat_l10_avg != null || pitcherSideContext.over_line_l5_rate != null || pitcherSideContext.over_line_l10_rate != null) &&
            (pitcherSideContext.ip_l5_avg != null || pitcherSideContext.bf_l5_avg != null)
          ) pitcherSideEnhancedCount++;
          else pitcherSideMissingContextCount++;
          break;
        case "HITS_ALLOWED":
          pitcherSideContext = buildPitcherSideContext(logs, line.threshold, (log) => log.hits_allowed ?? null);
          {
            const enhancedRf = scoreRecentFormPitcherSide(pitcherSideContext, rolling, line.threshold, "ha");
            const enhancedOpp = scoreOpportunityPitcherSide(pitcherSideContext);
            const thresholdEdge = scoreThresholdEdge(
              line.threshold,
              [
                { label: "haL3", value: pitcherSideContext.stat_l3_avg, weight: 0.30 },
                { label: "haL5", value: pitcherSideContext.stat_l5_avg, weight: 0.35 },
                { label: "haL10", value: pitcherSideContext.stat_l10_avg, weight: 0.15 },
                { label: "rollL10", value: rolling?.window_l10_avg ?? null, weight: 0.20 },
              ],
              [
                { label: "overL5", value: pitcherSideContext.over_line_l5_rate, weight: 0.65 },
                { label: "overL10", value: pitcherSideContext.over_line_l10_rate, weight: 0.35 },
              ],
            );
            const workloadScore = scorePitcherWorkloadTrend(
              pitcherSideContext.ip_l3_avg,
              pitcherSideContext.ip_l5_avg,
              pitcherSideContext.bf_l3_avg,
              pitcherSideContext.bf_l5_avg,
            );
            rf.score = weightedAverageScore([
              { score: enhancedRf.score, weight: 0.72 },
              { score: thresholdEdge.score, weight: thresholdEdge.hasContext ? 0.28 : 0 },
            ]) ?? enhancedRf.score;
            rf.note = thresholdEdge.hasContext ? `${enhancedRf.note} | edge=${thresholdEdge.note}` : enhancedRf.note;
            opp.score = weightedAverageScore([
              { score: enhancedOpp.score, weight: 0.68 },
              { score: workloadScore.score, weight: workloadScore.hasContext ? 0.32 : 0 },
            ]) ?? enhancedOpp.score;
            opp.note = workloadScore.hasContext ? `${enhancedOpp.note} | workload=${workloadScore.note}` : enhancedOpp.note;
            if (thresholdEdge.hasContext) {
              incrementCount(contextUsedCounts, "threshold_edge_hits_allowed");
              pushUniqueTag(extraReasonTags, "threshold_edge");
            } else {
              incrementCount(contextMissingCounts, "threshold_edge_hits_allowed");
              incrementCount(fallbackNeutralContextCounts, "threshold_edge_hits_allowed");
            }
            if (workloadScore.hasContext) {
              incrementCount(contextUsedCounts, "pitcher_workload");
              pushUniqueTag(extraReasonTags, "pitcher_workload");
            } else {
              incrementCount(contextMissingCounts, "pitcher_workload");
              incrementCount(fallbackNeutralContextCounts, "pitcher_workload");
              missingCriticalContexts.push("workload");
            }
          }
          mu = scoreMatchupHitsAllowed(oppOff, ownPitcherMatchup);
          if (oppOff?.hits_per_game != null || ownPitcherMatchup?.hits_allowed_avg != null) incrementCount(contextUsedCounts, "opponent_offense_tendency");
          else {
            incrementCount(contextMissingCounts, "opponent_offense_tendency");
            incrementCount(fallbackNeutralContextCounts, "opponent_offense_tendency");
            missingCriticalContexts.push("opponent_tendency");
          }
          if (
            (pitcherSideContext.stat_l5_avg != null || pitcherSideContext.stat_l10_avg != null || pitcherSideContext.over_line_l5_rate != null || pitcherSideContext.over_line_l10_rate != null) &&
            (pitcherSideContext.ip_l5_avg != null || pitcherSideContext.bf_l5_avg != null)
          ) pitcherSideEnhancedCount++;
          else pitcherSideMissingContextCount++;
          break;
        case "EARNED_RUNS_ALLOWED":
          pitcherSideContext = buildPitcherSideContext(logs, line.threshold, (log) => log.earned_runs_allowed ?? null);
          {
            const enhancedRf = scoreRecentFormPitcherSide(pitcherSideContext, rolling, line.threshold, "er");
            const enhancedOpp = scoreOpportunityPitcherSide(pitcherSideContext);
            const thresholdEdge = scoreThresholdEdge(
              line.threshold,
              [
                { label: "erL3", value: pitcherSideContext.stat_l3_avg, weight: 0.30 },
                { label: "erL5", value: pitcherSideContext.stat_l5_avg, weight: 0.35 },
                { label: "erL10", value: pitcherSideContext.stat_l10_avg, weight: 0.15 },
                { label: "rollL10", value: rolling?.window_l10_avg ?? null, weight: 0.20 },
              ],
              [
                { label: "overL5", value: pitcherSideContext.over_line_l5_rate, weight: 0.65 },
                { label: "overL10", value: pitcherSideContext.over_line_l10_rate, weight: 0.35 },
              ],
            );
            const workloadScore = scorePitcherWorkloadTrend(
              pitcherSideContext.ip_l3_avg,
              pitcherSideContext.ip_l5_avg,
              pitcherSideContext.bf_l3_avg,
              pitcherSideContext.bf_l5_avg,
            );
            rf.score = weightedAverageScore([
              { score: enhancedRf.score, weight: 0.72 },
              { score: thresholdEdge.score, weight: thresholdEdge.hasContext ? 0.28 : 0 },
            ]) ?? enhancedRf.score;
            rf.note = thresholdEdge.hasContext ? `${enhancedRf.note} | edge=${thresholdEdge.note}` : enhancedRf.note;
            opp.score = weightedAverageScore([
              { score: enhancedOpp.score, weight: 0.68 },
              { score: workloadScore.score, weight: workloadScore.hasContext ? 0.32 : 0 },
            ]) ?? enhancedOpp.score;
            opp.note = workloadScore.hasContext ? `${enhancedOpp.note} | workload=${workloadScore.note}` : enhancedOpp.note;
            if (thresholdEdge.hasContext) {
              incrementCount(contextUsedCounts, "threshold_edge_earned_runs_allowed");
              pushUniqueTag(extraReasonTags, "threshold_edge");
            } else {
              incrementCount(contextMissingCounts, "threshold_edge_earned_runs_allowed");
              incrementCount(fallbackNeutralContextCounts, "threshold_edge_earned_runs_allowed");
            }
            if (workloadScore.hasContext) {
              incrementCount(contextUsedCounts, "pitcher_workload");
              pushUniqueTag(extraReasonTags, "pitcher_workload");
            } else {
              incrementCount(contextMissingCounts, "pitcher_workload");
              incrementCount(fallbackNeutralContextCounts, "pitcher_workload");
              missingCriticalContexts.push("workload");
            }
          }
          mu = scoreMatchupEarnedRuns(oppOff, ownPitcherMatchup, pitcherCtx);
          if (oppOff?.runs_per_game != null || oppOff?.ops != null || ownPitcherMatchup?.earned_runs_allowed_avg != null) incrementCount(contextUsedCounts, "opponent_offense_tendency");
          else {
            incrementCount(contextMissingCounts, "opponent_offense_tendency");
            incrementCount(fallbackNeutralContextCounts, "opponent_offense_tendency");
            missingCriticalContexts.push("opponent_tendency");
          }
          if (
            (pitcherSideContext.stat_l5_avg != null || pitcherSideContext.stat_l10_avg != null || pitcherSideContext.over_line_l5_rate != null || pitcherSideContext.over_line_l10_rate != null) &&
            (pitcherSideContext.ip_l5_avg != null || pitcherSideContext.bf_l5_avg != null)
          ) pitcherSideEnhancedCount++;
          else pitcherSideMissingContextCount++;
          break;
        default:
          mu = scoreMatchupPitcher(null, pitcherCtx);
      }
    } else {
      const logs = hitterLogsByPlayer.get(line.player_id!) ?? [];
      opp = scoreOpportunityBatter(logs);

      // Find batter's game context → opposing pitcher's matchup summary.
      let oppPitcherSummary: PitcherMatchup | null = null;
      let ctxForGame: MlbGameContext | null = null;
      const myTeamId = profile?.mlb_team_id ?? null;
      if (myTeamId != null) {
        for (const c of ctxByGameId.values()) {
          const ctxJson = c.game_context_json as Record<string, unknown> | null;
          const homeTeamId = Number(ctxJson?.home_team_id);
          const awayTeamId = Number(ctxJson?.away_team_id);
          if (!Number.isFinite(homeTeamId) || !Number.isFinite(awayTeamId)) continue;
          if (myTeamId === homeTeamId && c.probable_away_pitcher_id) {
            oppPitcherSummary = pitcherMatchupById.get(c.probable_away_pitcher_id) ?? null;
            ctxForGame = c;
            break;
          }
          if (myTeamId === awayTeamId && c.probable_home_pitcher_id) {
            oppPitcherSummary = pitcherMatchupById.get(c.probable_home_pitcher_id) ?? null;
            ctxForGame = c;
            break;
          }
        }
      }

      if (statKey === "HOME_RUNS") {
        // For HR matchup we want the OPPOSING team's offense — but here the
        // batter IS on the offense; we pass the opposing pitcher's stats only.
        mu = scoreMatchupHomeRun(oppPitcherSummary, null, ctxForGame);
      } else {
        mu = scoreMatchupBatter(
          oppPitcherSummary,
          ctxForGame,
          statKey === "TOTAL_BASES" ? "TOTAL_BASES" : "HITS",
        );
      }
      const thresholdEdge = scoreThresholdEdge(
        line.threshold,
        [
          { label: "rollL5", value: rolling?.window_l5_avg ?? null, weight: 0.40 },
          { label: "rollL10", value: rolling?.window_l10_avg ?? null, weight: 0.35 },
          { label: "rollL15", value: rolling?.window_l15_avg ?? null, weight: 0.15 },
          { label: "paProxy", value: logs.length > 0 ? averageDefined(logs.slice(0, 5).map((log) => (log.plate_appearances ?? log.at_bats ?? null))) : null, weight: 0.10 },
        ],
        [
          { label: "hitL5", value: rolling?.window_l5_hit_rate ?? null, weight: 0.60 },
          { label: "hitL10", value: rolling?.window_l10_hit_rate ?? null, weight: 0.40 },
        ],
      );
      rf.score = weightedAverageScore([
        { score: rf.score, weight: 0.72 },
        { score: thresholdEdge.score, weight: thresholdEdge.hasContext ? 0.28 : 0 },
      ]) ?? rf.score;
      rf.note = thresholdEdge.hasContext ? `${rf.note} | edge=${thresholdEdge.note}` : rf.note;
      if (thresholdEdge.hasContext) {
        incrementCount(contextUsedCounts, `threshold_edge_${statKey.toLowerCase()}`);
        pushUniqueTag(extraReasonTags, "threshold_edge");
      } else {
        incrementCount(contextMissingCounts, `threshold_edge_${statKey.toLowerCase()}`);
        incrementCount(fallbackNeutralContextCounts, `threshold_edge_${statKey.toLowerCase()}`);
      }
      if (oppPitcherSummary) incrementCount(contextUsedCounts, "opposing_pitcher_matchup");
      else {
        incrementCount(contextMissingCounts, "opposing_pitcher_matchup");
        incrementCount(fallbackNeutralContextCounts, "opposing_pitcher_matchup");
        missingCriticalContexts.push("matchup");
      }
      const parkWeatherMode =
        statKey === "TOTAL_BASES" || statKey === "HOME_RUNS" ? "hitter_power" : "hitter_contact";
      const parkWeatherAdjustment = adjustForParkWeather(
        mu.score,
        ctxForGame,
        parkWeatherMode,
      );
      mu.score = parkWeatherAdjustment.score;
      if (parkWeatherAdjustment.note) mu.note = `${mu.note} ${parkWeatherAdjustment.note}`.trim();
      if (parkWeatherAdjustment.usedPark) incrementCount(contextUsedCounts, "park_factor");
      else incrementCount(contextMissingCounts, "park_factor");
      if (parkWeatherAdjustment.usedWeather) incrementCount(contextUsedCounts, "weather");
      else incrementCount(contextMissingCounts, "weather");
      incrementCount(contextMissingCounts, "handedness_splits");
      incrementCount(fallbackNeutralContextCounts, "handedness_splits");
    }

    if (lineQuality) {
      const lineQualityBlend = weightedAverageScore([
        { score: vl.score, weight: 0.7 },
        { score: lineQuality.line_quality_score, weight: 0.3 },
      ]);
      if (lineQualityBlend != null) vl.score = lineQualityBlend;
    } else {
      missingCriticalContexts.push("line_quality");
    }

    const w = WEIGHT_PROFILES[statKey];
    const positive =
      w.recent_form * rf.score +
      w.matchup * mu.score +
      w.opportunity * opp.score +
      w.consistency * cs.score +
      w.value * vl.score;
    const positiveDen = w.recent_form + w.matchup + w.opportunity + w.consistency + w.value;
    const positiveScore = positive / positiveDen; // 0..100
    let overall = clamp(positiveScore - w.risk_penalty * (rk.score - 50) / 2);
    if (lineQuality) {
      overall = clamp(overall + lineQualityAdjustment(lineQuality.line_quality_tier));
    }
    const capped = applyConservativeConfidenceCap(
      statKey,
      overall,
      [...new Set(missingCriticalContexts)],
      rk.score,
      lineQuality?.line_quality_tier ?? null,
    );
    overall = capped.score;
    if (capped.capped && capped.reason) {
      incrementCount(cappedConfidenceCounts, capped.reason);
      pushUniqueTag(extraReasonTags, "context_missing_neutral");
    }
    const tier = tierFor(overall);

    const summary = {
      version: "mlb-v2",
      stat_key: statKey,
      threshold: line.threshold,
      sample_size: sampleSize,
      axes: {
        recent_form: { score: round1(rf.score), note: rf.note, weight: w.recent_form },
        matchup: { score: round1(mu.score), note: mu.note, weight: w.matchup },
        opportunity: { score: round1(opp.score), note: opp.note, weight: w.opportunity },
        consistency: { score: round1(cs.score), note: cs.note, weight: w.consistency },
        value: { score: round1(vl.score), note: vl.note, weight: w.value },
        risk: { score: round1(rk.score), note: rk.note, penalty_weight: w.risk_penalty },
      },
      overall: round1(overall),
      tier,
      missing_contexts: [...new Set(missingCriticalContexts)],
      confidence_cap_reason: capped.reason,
    } as Record<string, unknown>;
    if (statKey === "STRIKEOUTS") {
      if (!strikeoutContext) {
        const logs = pitcherLogsByPlayer.get(line.player_id!) ?? [];
        strikeoutContext = buildStrikeoutsContext(
          logs,
          line.threshold,
          strikeoutOpponentOff?.strikeout_rate ?? null,
        );
      }

      summary.k_l3_avg = strikeoutContext.k_l3_avg != null ? round1(strikeoutContext.k_l3_avg) : null;
      summary.k_l5_avg = strikeoutContext.k_l5_avg != null ? round1(strikeoutContext.k_l5_avg) : null;
      summary.k_l10_avg = strikeoutContext.k_l10_avg != null ? round1(strikeoutContext.k_l10_avg) : null;
      summary.ip_l3_avg = strikeoutContext.ip_l3_avg != null ? round1(strikeoutContext.ip_l3_avg) : null;
      summary.ip_l5_avg = strikeoutContext.ip_l5_avg != null ? round1(strikeoutContext.ip_l5_avg) : null;
      summary.bf_l3_avg = strikeoutContext.bf_l3_avg != null ? round1(strikeoutContext.bf_l3_avg) : null;
      summary.bf_l5_avg = strikeoutContext.bf_l5_avg != null ? round1(strikeoutContext.bf_l5_avg) : null;
      summary.over_line_l5_rate = strikeoutContext.over_line_l5_rate != null
        ? round1(strikeoutContext.over_line_l5_rate * 100) / 100
        : null;
      summary.over_line_l10_rate = strikeoutContext.over_line_l10_rate != null
        ? round1(strikeoutContext.over_line_l10_rate * 100) / 100
        : null;
      summary.opponent_k_rate = strikeoutContext.opponent_k_rate != null
        ? round1(strikeoutContext.opponent_k_rate * 1000) / 1000
        : null;

      const recentKAvg = strikeoutContext.k_l5_avg ?? strikeoutContext.k_l3_avg;
      if (recentKAvg != null) {
        if (recentKAvg >= line.threshold + 1) extraReasonTags.push("strong_recent_k_form");
        else if (recentKAvg <= line.threshold - 1) extraReasonTags.push("weak_recent_k_form");
      }

      const ipAvg = strikeoutContext.ip_l5_avg ?? strikeoutContext.ip_l3_avg;
      const bfAvg = strikeoutContext.bf_l5_avg ?? strikeoutContext.bf_l3_avg;
      if (ipAvg != null || bfAvg != null) {
        if ((ipAvg ?? 0) >= 6 && (bfAvg ?? 0) >= 24) extraReasonTags.push("strong_workload");
        else if ((ipAvg != null && ipAvg <= 4.8) || (bfAvg != null && bfAvg <= 19)) {
          extraReasonTags.push("limited_workload");
        }
      }

      if (strikeoutContext.opponent_k_rate != null) {
        if (strikeoutContext.opponent_k_rate >= 0.24) extraReasonTags.push("high_k_opponent");
        else if (strikeoutContext.opponent_k_rate <= 0.20) extraReasonTags.push("low_k_opponent");
      }

      const overLineRateValue = strikeoutContext.over_line_l5_rate ?? strikeoutContext.over_line_l10_rate;
      if (overLineRateValue != null) {
        if (overLineRateValue >= 0.6) extraReasonTags.push("strong_over_line_history");
        else if (overLineRateValue <= 0.4) extraReasonTags.push("weak_over_line_history");
      }

      if (strikeoutContext.bf_l3_avg == null && strikeoutContext.bf_l5_avg == null) {
        summary.bf_context_note = "batters_faced is present in mlb_pitcher_game_logs but empty/null for recent starts";
      }
    }

    if (lineQuality) {
      summary.book_count = lineQuality.book_count;
      summary.best_over_price = lineQuality.best_over_price;
      summary.best_under_price = lineQuality.best_under_price;
      summary.average_over_price = lineQuality.average_over_price != null ? round1(lineQuality.average_over_price) : null;
      summary.line_spread = lineQuality.line_spread;
      summary.consensus_threshold = lineQuality.consensus_threshold;
      summary.threshold_is_consensus = lineQuality.threshold_is_consensus;
      summary.odds_freshness_minutes = lineQuality.odds_freshness_minutes;
      summary.line_quality_score = lineQuality.line_quality_score;
      summary.line_quality_tier = lineQuality.line_quality_tier;

      if (lineQuality.line_quality_tier === "elite") extraReasonTags.push("line_quality_elite");
      else if (lineQuality.line_quality_tier === "strong") extraReasonTags.push("line_quality_strong");
      else if (lineQuality.line_quality_tier === "weak") extraReasonTags.push("line_quality_weak");

      if (lineQuality.threshold_is_consensus) extraReasonTags.push("consensus_line");
      else extraReasonTags.push("non_consensus_line");

      if (lineQuality.book_count >= 2) extraReasonTags.push("multi_book_market");
      else extraReasonTags.push("single_book_market");

      if (lineQuality.odds_freshness_minutes != null && lineQuality.odds_freshness_minutes > 30) {
        extraReasonTags.push("stale_line");
      } else {
        extraReasonTags.push("fresh_line");
      }
    }

    if (
      statKey === "EARNED_RUNS_ALLOWED" ||
      statKey === "HITS_ALLOWED" ||
      statKey === "WALKS_ALLOWED"
    ) {
      if (!pitcherSideContext) {
        const logs = pitcherLogsByPlayer.get(line.player_id!) ?? [];
        pitcherSideContext = buildPitcherSideContext(
          logs,
          line.threshold,
          statKey === "EARNED_RUNS_ALLOWED"
            ? (log) => log.earned_runs_allowed ?? null
            : statKey === "HITS_ALLOWED"
            ? (log) => log.hits_allowed ?? null
            : (log) => log.walks_allowed ?? null,
        );
      }

      summary.ip_l3_avg = pitcherSideContext.ip_l3_avg != null ? round1(pitcherSideContext.ip_l3_avg) : null;
      summary.ip_l5_avg = pitcherSideContext.ip_l5_avg != null ? round1(pitcherSideContext.ip_l5_avg) : null;
      summary.bf_l3_avg = pitcherSideContext.bf_l3_avg != null ? round1(pitcherSideContext.bf_l3_avg) : null;
      summary.bf_l5_avg = pitcherSideContext.bf_l5_avg != null ? round1(pitcherSideContext.bf_l5_avg) : null;

      if (statKey === "EARNED_RUNS_ALLOWED") {
        summary.er_l3_avg = pitcherSideContext.stat_l3_avg != null ? round1(pitcherSideContext.stat_l3_avg) : null;
        summary.er_l5_avg = pitcherSideContext.stat_l5_avg != null ? round1(pitcherSideContext.stat_l5_avg) : null;
        summary.er_l10_avg = pitcherSideContext.stat_l10_avg != null ? round1(pitcherSideContext.stat_l10_avg) : null;
        summary.er_over_line_l5_rate = pitcherSideContext.over_line_l5_rate != null
          ? round1(pitcherSideContext.over_line_l5_rate * 100) / 100
          : null;
        summary.er_over_line_l10_rate = pitcherSideContext.over_line_l10_rate != null
          ? round1(pitcherSideContext.over_line_l10_rate * 100) / 100
          : null;
      } else if (statKey === "HITS_ALLOWED") {
        summary.hits_allowed_l3_avg = pitcherSideContext.stat_l3_avg != null ? round1(pitcherSideContext.stat_l3_avg) : null;
        summary.hits_allowed_l5_avg = pitcherSideContext.stat_l5_avg != null ? round1(pitcherSideContext.stat_l5_avg) : null;
        summary.hits_allowed_l10_avg = pitcherSideContext.stat_l10_avg != null ? round1(pitcherSideContext.stat_l10_avg) : null;
        summary.hits_allowed_over_line_l5_rate = pitcherSideContext.over_line_l5_rate != null
          ? round1(pitcherSideContext.over_line_l5_rate * 100) / 100
          : null;
        summary.hits_allowed_over_line_l10_rate = pitcherSideContext.over_line_l10_rate != null
          ? round1(pitcherSideContext.over_line_l10_rate * 100) / 100
          : null;
      } else {
        summary.walks_allowed_l3_avg = pitcherSideContext.stat_l3_avg != null ? round1(pitcherSideContext.stat_l3_avg) : null;
        summary.walks_allowed_l5_avg = pitcherSideContext.stat_l5_avg != null ? round1(pitcherSideContext.stat_l5_avg) : null;
        summary.walks_allowed_l10_avg = pitcherSideContext.stat_l10_avg != null ? round1(pitcherSideContext.stat_l10_avg) : null;
        summary.walks_allowed_over_line_l5_rate = pitcherSideContext.over_line_l5_rate != null
          ? round1(pitcherSideContext.over_line_l5_rate * 100) / 100
          : null;
        summary.walks_allowed_over_line_l10_rate = pitcherSideContext.over_line_l10_rate != null
          ? round1(pitcherSideContext.over_line_l10_rate * 100) / 100
          : null;
      }

      const recentAllowedAvg = pitcherSideContext.stat_l5_avg ?? pitcherSideContext.stat_l3_avg;
      if (recentAllowedAvg != null) {
        if (statKey === "EARNED_RUNS_ALLOWED") {
          if (recentAllowedAvg >= line.threshold + 0.5) extraReasonTags.push("high_recent_er_allowed");
          else if (recentAllowedAvg <= line.threshold - 0.5) extraReasonTags.push("low_recent_er_allowed");
        } else if (statKey === "HITS_ALLOWED") {
          if (recentAllowedAvg >= line.threshold + 1) extraReasonTags.push("high_recent_hits_allowed");
          else if (recentAllowedAvg <= line.threshold - 1) extraReasonTags.push("low_recent_hits_allowed");
        } else {
          if (recentAllowedAvg >= line.threshold + 0.5) extraReasonTags.push("high_recent_walks_allowed");
          else if (recentAllowedAvg <= line.threshold - 0.5) extraReasonTags.push("low_recent_walks_allowed");
        }
      }

      const ipAvg = pitcherSideContext.ip_l5_avg ?? pitcherSideContext.ip_l3_avg;
      const bfAvg = pitcherSideContext.bf_l5_avg ?? pitcherSideContext.bf_l3_avg;
      if (ipAvg != null || bfAvg != null) {
        if ((ipAvg ?? 0) >= 6 && (bfAvg ?? 0) >= 24) extraReasonTags.push("strong_pitcher_workload");
        else if ((ipAvg != null && ipAvg <= 4.8) || (bfAvg != null && bfAvg <= 19)) {
          extraReasonTags.push("limited_pitcher_workload");
        }
      }

      const overLineRateValue = pitcherSideContext.over_line_l5_rate ?? pitcherSideContext.over_line_l10_rate;
      if (overLineRateValue != null) {
        if (overLineRateValue >= 0.6) extraReasonTags.push("strong_over_line_history");
        else if (overLineRateValue <= 0.4) extraReasonTags.push("weak_over_line_history");
      }

      if (pitcherSideContext.bf_l3_avg == null && pitcherSideContext.bf_l5_avg == null) {
        summary.bf_context_note = "batters_faced is present in mlb_pitcher_game_logs but empty/null for recent starts";
      }
    }

    if (rf.score >= 65) pushUniqueTag(extraReasonTags, "recent_form");
    if (mu.score >= 64) pushUniqueTag(extraReasonTags, "matchup_boost");
    else if (mu.score <= 42) pushUniqueTag(extraReasonTags, "matchup_neutral");
    if (missingCriticalContexts.length > 0) pushUniqueTag(extraReasonTags, "context_missing_neutral");

    // Resolve team / opponent / home_away from the team-id map built earlier.
    const myTeamId = profile?.mlb_team_id ?? null;
    const teamAbbr = myTeamId != null ? teamIdToAbbr.get(myTeamId) ?? null : null;
    const gameInfo = myTeamId != null ? teamGameInfo.get(myTeamId) ?? null : null;
    const opponentAbbr = gameInfo
      ? (myTeamId === gameInfo.homeId ? gameInfo.awayAbbr : gameInfo.homeAbbr)
      : null;
    const homeAway = gameInfo
      ? (myTeamId === gameInfo.homeId ? "home" : "away")
      : null;

    if (!teamAbbr) {
      nullTeamAbbrScoreCount++;
      const reason =
        myTeamId == null
          ? "missing_profile_team_id"
          : teamIdToAbbr.has(myTeamId)
          ? "missing_game_context_for_team"
          : "missing_team_map_for_profile_team_id";
      nullTeamAbbrReasons[reason] = (nullTeamAbbrReasons[reason] || 0) + 1;
    }

    rowsToUpsert.push({
      sport: "MLB",
      game_date: gameDate,
      player_id: line.player_id!,
      player_name: line.player_name,
      stat_type: statKey,                 // store internal key, not Odds-API key
      threshold: line.threshold,
      team_abbr: teamAbbr,
      opponent_abbr: opponentAbbr,
      home_away: homeAway,
      // Legacy NBA-shaped fields (kept null for MLB v1 — they aren't used downstream for MLB).
      confidence_score: round1(overall),  // mirror so legacy reads still work
      value_score: round1(vl.score),
      consistency_score: round1(cs.score),
      volatility_score: round1(rk.score),
      // New multi-axis fields.
      score_overall: round1(overall),
      score_recent_form: round1(rf.score),
      score_matchup: round1(mu.score),
      score_opportunity: round1(opp.score),
      score_consistency: round1(cs.score),
      score_value: round1(vl.score),
      score_risk: round1(rk.score),
      confidence_tier: tier,
      summary_json: summary,
      reason_tags: [
        `tier:${tier}`,
        `form:${round1(rf.score)}`,
        `matchup:${round1(mu.score)}`,
        `opp:${round1(opp.score)}`,
        ...extraReasonTags,
      ],
      scored_at: new Date().toISOString(),
    });
    scoredCount++;
  }

  // 4) Upsert in chunks.
  const CHUNK = 200;
  let writeErrors = 0;
  for (let i = 0; i < rowsToUpsert.length; i += CHUNK) {
    const chunk = rowsToUpsert.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("player_prop_scores")
      .upsert(chunk, { onConflict: "game_date,player_id,stat_type,threshold" });
    if (error) {
      writeErrors++;
      console.error(`[score-mlb-anchors] upsert error chunk ${i / CHUNK}:`, error.message);
    }
  }

  return new Response(
    JSON.stringify({
      ok: writeErrors === 0,
      sport: "MLB",
      game_date: gameDate,
      lines_evaluated: lines.length,
      scored_count: scoredCount,
      skipped: skippedCount,
      strikeouts_enhanced_count: strikeoutsEnhancedCount,
      strikeouts_missing_context_count: strikeoutsMissingContextCount,
      pitcher_side_enhanced_count: pitcherSideEnhancedCount,
      pitcher_side_missing_context_count: pitcherSideMissingContextCount,
      line_quality_enhanced_count: lineQualityEnhancedCount,
      line_quality_missing_count: lineQualityMissingCount,
      line_quality_weak_count: lineQualityWeakCount,
      line_quality_elite_count: lineQualityEliteCount,
      null_team_abbr_score_count: nullTeamAbbrScoreCount,
      null_team_abbr_reasons: nullTeamAbbrReasons,
      context_used_counts: contextUsedCounts,
      context_missing_counts: contextMissingCounts,
      weights_applied_by_stat_type: weightsAppliedByStatType,
      capped_confidence_counts: cappedConfidenceCounts,
      fallback_neutral_context_counts: fallbackNeutralContextCounts,
      write_errors: writeErrors,
      anchors: ANCHOR_KEYS,
      duration_ms: Date.now() - startedAt,
      stubbed: [
        "park_factor / weather adjustments (only applied if numeric in game_context_json)",
        "implied-probability value math (v1 uses gap from rolling mean only)",
        "lineup-confirmation boost (v1 only filters OUT)",
        "per-handedness vs L/R splits (vs_left_avg / vs_right_avg are read but not yet weighted)",
      ],
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

// ============================================================
// BetStreaks — MLB Anchor Scoring v1
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
//   3. Keep v1 lightweight: deterministic numeric axes, no ML.
//   4. Be safe when data is missing — every axis falls back to
//      a neutral 50 so "no data" never produces a confident pick.
//   5. Per-prop weight profiles match the spec the product team
//      locked for v1 (see WEIGHT_PROFILES below).
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
// What is intentionally stubbed for v1:
//   - Park factor / weather adjustments are read but only used
//     when game_context_json contains a numeric `park_factor`
//     or `wind_out_mph` field. Otherwise they no-op.
//   - Lineup confirmation (player_availability) is consulted only
//     to drop OUT players, not to boost confidence.
//   - Odds-line value scoring uses simple distance from rolling
//     mean vs threshold; no implied probability math yet.
//
// Entry point: POST /functions/v1/score-mlb-anchors
//   Body: { game_date?: "YYYY-MM-DD" }   (defaults to today ET)
// ============================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";
import {
  MLB_MARKET_MAP,
  MLB_STAT_KEYS,
  type MlbStatKey,
} from "../_shared/mlbMarketMap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── v1 anchors only ──
const ANCHOR_KEYS: MlbStatKey[] = ["HITS", "TOTAL_BASES", "STRIKEOUTS"];

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
  // Other 4 props are not scored in v1 but kept here so type stays exhaustive.
  HOME_RUNS:           { recent_form: 0.25, matchup: 0.25, opportunity: 0.15, consistency: 0.10, value: 0.25, risk_penalty: 0.25 },
  EARNED_RUNS_ALLOWED: { recent_form: 0.25, matchup: 0.30, opportunity: 0.20, consistency: 0.15, value: 0.10, risk_penalty: 0.20 },
  WALKS_ALLOWED:       { recent_form: 0.30, matchup: 0.20, opportunity: 0.20, consistency: 0.20, value: 0.10, risk_penalty: 0.15 },
  HITS_ALLOWED:        { recent_form: 0.27, matchup: 0.28, opportunity: 0.20, consistency: 0.15, value: 0.10, risk_penalty: 0.18 },
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
  opponent_team_id: number | null;
}

interface PitcherMatchup {
  pitcher_id: number;
  hits_allowed_avg: number | null;
  earned_runs_allowed_avg: number | null;
  strikeouts_avg: number | null;
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
}

// ── Main handler ──
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
    .select("player_id,player_name,stat_type,threshold,game_date,over_odds,under_odds,sportsbook")
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
    // Pull profiles whose name matches case-insensitively. We fetch ALL profiles
    // with non-null names in one shot since the table is small (~7k rows) and
    // SportsDataIO names occasionally differ in punctuation from sportsbook feeds.
    const { data: nameRows } = await supabase
      .from("mlb_player_profiles")
      .select("player_id,player_name")
      .not("player_name", "is", null);
    for (const r of (nameRows ?? []) as Array<{ player_id: number; player_name: string }>) {
      const k = normName(r.player_name);
      if (k && !nameToPid.has(k)) nameToPid.set(k, Number(r.player_id));
    }
  }

  let resolvedReal = 0;
  let resolvedSynth = 0;
  const dedup = new Map<string, LineSnapshot>();
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
      .select("player_id,game_date,innings_pitched,batters_faced,opponent_team_id")
      .in("player_id", playerIds)
      .lt("game_date", gameDate)
      .order("game_date", { ascending: false })
      .limit(5 * playerIds.length),
    supabase
      .from("games_today")
      .select("id,sport,game_date,home_team_abbr,away_team_abbr")
      .eq("sport", "MLB")
      .eq("game_date", gameDate),
    supabase
      .from("mlb_game_context")
      .select("game_id,probable_home_pitcher_id,probable_away_pitcher_id,game_context_json"),
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
    if (arr.length < 5) arr.push(l);
    pitcherLogsByPlayer.set(l.player_id, arr);
  }

  // Today's MLB game ids → context.
  const todaysGameIds = new Set((gamesToday ?? []).map((g) => g.id));
  const ctxByGameId = new Map<string, MlbGameContext>();
  for (const c of (ctxRows ?? []) as MlbGameContext[]) {
    if (todaysGameIds.has(c.game_id)) ctxByGameId.set(c.game_id, c);
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
      .select("pitcher_id,hits_allowed_avg,earned_runs_allowed_avg,strikeouts_avg,as_of_date")
      .in("pitcher_id", [...probablePitcherIds])
      .lte("as_of_date", gameDate)
      .order("as_of_date", { ascending: false });
    for (const p of (pms ?? []) as (PitcherMatchup & { as_of_date: string })[]) {
      if (!pitcherMatchupById.has(p.pitcher_id)) {
        pitcherMatchupById.set(p.pitcher_id, p);
      }
    }
  }

  // Opposing-team K-rate for STRIKEOUTS prop matchup.
  // (Best-effort: we only have access to mlb_team_offense_daily by team_id; we
  // resolve the opposing team via the most-recent pitcher_log opponent_team_id.)
  const oppTeamIds = new Set<number>();
  for (const log of pitcherLogs ?? []) {
    if (log.opponent_team_id) oppTeamIds.add(log.opponent_team_id);
  }
  let teamKRateById = new Map<number, number>();
  if (oppTeamIds.size > 0) {
    const { data: offRows } = await supabase
      .from("mlb_team_offense_daily")
      .select("team_id,strikeout_rate,as_of_date,split_type")
      .in("team_id", [...oppTeamIds])
      .eq("split_type", "overall")
      .lte("as_of_date", gameDate)
      .order("as_of_date", { ascending: false });
    for (const r of offRows ?? []) {
      if (!teamKRateById.has(r.team_id) && r.strikeout_rate != null) {
        teamKRateById.set(r.team_id, Number(r.strikeout_rate));
      }
    }
  }

  // 3) Score each line.
  const rowsToUpsert: Record<string, unknown>[] = [];
  let scoredCount = 0;
  let skippedCount = 0;

  for (const line of lines) {
    const statKey = oddsToStatKey[line.stat_type];
    if (!statKey) { skippedCount++; continue; }
    const profile = profileById.get(line.player_id!);
    const isPitcherProp = MLB_MARKET_MAP[statKey].role === "pitcher";

    const rolling = rollingByKey.get(`${line.player_id}|${statKey}`) ?? null;
    const sampleSize = rolling?.sample_size ?? 0;

    // Recent form, consistency, risk, value (shared across props).
    const rf = scoreRecentForm(rolling, line.threshold);
    const cs = scoreConsistency(rolling);
    const rk = scoreRisk(rolling, sampleSize);
    const vl = scoreValue(rolling, line.threshold);

    // Opportunity + matchup vary by role.
    let opp: { score: number; note: string };
    let mu: { score: number; note: string };

    if (isPitcherProp) {
      const logs = pitcherLogsByPlayer.get(line.player_id!) ?? [];
      opp = scoreOpportunityPitcher(logs);

      // Find this pitcher's game context today, if any.
      let oppTeamId: number | null = null;
      for (const c of ctxByGameId.values()) {
        if (
          c.probable_home_pitcher_id === line.player_id ||
          c.probable_away_pitcher_id === line.player_id
        ) {
          // Best proxy for opposing team: use the most recent log's opponent.
          oppTeamId = logs[0]?.opponent_team_id ?? null;
          mu = scoreMatchupPitcher(
            oppTeamId != null ? teamKRateById.get(oppTeamId) ?? null : null,
            c,
          );
          break;
        }
      }
      // @ts-expect-error mu may be unset above if no context match.
      if (!mu) mu = scoreMatchupPitcher(null, null);
    } else {
      const logs = hitterLogsByPlayer.get(line.player_id!) ?? [];
      opp = scoreOpportunityBatter(logs);

      // Find batter's game context (their team plays today) → opposing pitcher.
      let oppPitcherSummary: PitcherMatchup | null = null;
      let ctxForGame: MlbGameContext | null = null;
      const myTeamId = profile?.mlb_team_id ?? null;
      if (myTeamId != null) {
        for (const c of ctxByGameId.values()) {
          // We don't have team_id on game_context directly; defer to best-effort
          // via probable pitcher list — we look up either pitcher's matchup row
          // and use the one whose team is NOT this batter's team if known.
          // For v1 we just pick whichever probable pitcher has a summary row.
          const candidate =
            (c.probable_home_pitcher_id && pitcherMatchupById.get(c.probable_home_pitcher_id)) ||
            (c.probable_away_pitcher_id && pitcherMatchupById.get(c.probable_away_pitcher_id)) ||
            null;
          if (candidate) {
            oppPitcherSummary = candidate;
            ctxForGame = c;
            break;
          }
        }
      }
      mu = scoreMatchupBatter(
        oppPitcherSummary,
        ctxForGame,
        statKey === "TOTAL_BASES" ? "TOTAL_BASES" : "HITS",
      );
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
    const overall = clamp(positiveScore - w.risk_penalty * (rk.score - 50) / 2);
    const tier = tierFor(overall);

    const summary = {
      version: "mlb-anchor-v1",
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
    };

    rowsToUpsert.push({
      sport: "MLB",
      game_date: gameDate,
      player_id: line.player_id!,
      player_name: line.player_name,
      stat_type: statKey,                 // store internal key, not Odds-API key
      threshold: line.threshold,
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

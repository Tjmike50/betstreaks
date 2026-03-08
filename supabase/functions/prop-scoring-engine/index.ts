import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const STAT_MAP: Record<string, string> = {
  pts: "pts", reb: "reb", ast: "ast", fg3m: "fg3m", "3pm": "fg3m", stl: "stl", blk: "blk",
};

const DEFAULT_THRESHOLDS: Record<string, number[]> = {
  pts: [15.5, 19.5, 24.5, 29.5],
  reb: [4.5, 6.5, 8.5, 10.5],
  ast: [3.5, 5.5, 7.5, 9.5],
  fg3m: [1.5, 2.5, 3.5],
  stl: [0.5, 1.5],
  blk: [0.5, 1.5],
};

interface GameLog {
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  game_date: string;
  matchup: string | null;
  pts: number | null;
  reb: number | null;
  ast: number | null;
  fg3m: number | null;
  stl: number | null;
  blk: number | null;
  wl: string | null;
}

interface ScoredProp {
  player_id: number;
  player_name: string;
  team_abbr: string | null;
  opponent_abbr: string | null;
  home_away: string;
  stat_type: string;
  threshold: number;
  last3_avg: number | null;
  last5_avg: number | null;
  last10_avg: number | null;
  last15_avg: number | null;
  season_avg: number | null;
  last5_hit_rate: number | null;
  last10_hit_rate: number | null;
  last15_hit_rate: number | null;
  season_hit_rate: number | null;
  total_games: number;
  vs_opponent_avg: number | null;
  vs_opponent_hit_rate: number | null;
  vs_opponent_games: number;
  home_avg: number | null;
  away_avg: number | null;
  home_hit_rate: number | null;
  away_hit_rate: number | null;
  home_games: number;
  away_games: number;
  confidence_score: number;
  value_score: number;
  volatility_score: number;
  consistency_score: number;
  reason_tags: string[];
  // New fields
  rest_days: number | null;
  back_to_back: boolean;
  games_last_7: number;
  games_last_14: number;
  rest_hit_rate: number | null;
  rest_sample: number;
  opp_def_rank_note: string | null;
  opp_stat_avg_allowed: number | null;
  opp_stat_games: number;
  line_hit_rate_l5: number | null;
  line_hit_rate_l10: number | null;
  line_hit_rate_season: number | null;
}

function parseMatchup(matchup: string | null): { opponent: string | null; homeAway: string } {
  if (!matchup) return { opponent: null, homeAway: "unknown" };
  if (matchup.includes("vs.")) {
    const parts = matchup.split("vs.").map((s) => s.trim());
    return { opponent: parts[1] || null, homeAway: "home" };
  }
  if (matchup.includes("@")) {
    const parts = matchup.split("@").map((s) => s.trim());
    return { opponent: parts[1] || null, homeAway: "away" };
  }
  return { opponent: null, homeAway: "unknown" };
}

function calcAvg(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

function calcHitRate(values: number[], threshold: number): number | null {
  if (values.length === 0) return null;
  const hits = values.filter((v) => v >= threshold).length;
  return Math.round((hits / values.length) * 100) / 100;
}

function calcStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a), db = new Date(b);
  return Math.round(Math.abs(da.getTime() - db.getTime()) / 86400000);
}

/**
 * Compute rest/fatigue context from a player's sorted game logs (most recent first).
 */
function computeRestContext(logs: GameLog[], today: string) {
  if (logs.length === 0) return { rest_days: null, back_to_back: false, games_last_7: 0, games_last_14: 0 };

  const lastGameDate = logs[0].game_date;
  const rest_days = daysBetween(today, lastGameDate);
  const back_to_back = rest_days <= 1;

  const todayDate = new Date(today);
  let games_last_7 = 0, games_last_14 = 0;
  for (const g of logs) {
    const d = daysBetween(today, g.game_date);
    if (d <= 7) games_last_7++;
    if (d <= 14) games_last_14++;
    if (d > 14) break;
  }

  return { rest_days, back_to_back, games_last_7, games_last_14 };
}

/**
 * Compute rest-specific hit rate: how the player performs with similar rest days.
 */
function computeRestHitRate(logs: GameLog[], statKey: string, threshold: number, restDays: number | null): { rate: number | null; sample: number } {
  if (restDays == null || logs.length < 5) return { rate: null, sample: 0 };

  const col = STAT_MAP[statKey];
  if (!col) return { rate: null, sample: 0 };

  // Group: 0-1 = back-to-back, 2 = normal, 3+ = well-rested
  const bucket = restDays <= 1 ? "b2b" : restDays >= 3 ? "rested" : "normal";
  const vals: number[] = [];

  for (let i = 0; i < logs.length - 1; i++) {
    const val = (logs[i] as any)[col];
    if (val == null) continue;
    const nextGame = logs[i + 1];
    const gap = daysBetween(logs[i].game_date, nextGame.game_date);
    const gameBucket = gap <= 1 ? "b2b" : gap >= 3 ? "rested" : "normal";
    if (gameBucket === bucket) vals.push(val);
  }

  return { rate: calcHitRate(vals, threshold), sample: vals.length };
}

/**
 * Compute opponent defensive context: how much the opponent allows for this stat type.
 * Uses all game logs from players who faced this opponent.
 */
function computeDefensiveContext(
  allPlayerLogs: Record<number, GameLog[]>,
  opponentAbbr: string | null,
  statKey: string
): { avg_allowed: number | null; games: number; note: string | null } {
  if (!opponentAbbr) return { avg_allowed: null, games: 0, note: null };

  const col = STAT_MAP[statKey];
  if (!col) return { avg_allowed: null, games: 0, note: null };

  const vals: number[] = [];
  for (const logs of Object.values(allPlayerLogs)) {
    for (const g of logs) {
      const { opponent } = parseMatchup(g.matchup);
      if (opponent && opponent.trim().toUpperCase() === opponentAbbr.trim().toUpperCase()) {
        const v = (g as any)[col];
        if (v != null) vals.push(v);
      }
    }
  }

  if (vals.length < 5) return { avg_allowed: null, games: vals.length, note: vals.length > 0 ? "small_sample" : null };

  const avg = calcAvg(vals)!;
  return { avg_allowed: avg, games: vals.length, note: null };
}

function scoreProp(
  games: GameLog[],
  statKey: string,
  threshold: number,
  todayOpponent: string | null,
  todayHomeAway: string,
  restCtx: { rest_days: number | null; back_to_back: boolean; games_last_7: number; games_last_14: number },
  restHitCtx: { rate: number | null; sample: number },
  defCtx: { avg_allowed: number | null; games: number; note: string | null },
  allPlayerLogs: Record<number, GameLog[]>
): ScoredProp | null {
  if (games.length === 0) return null;

  const col = STAT_MAP[statKey];
  if (!col) return null;

  const allValues: number[] = [];
  const homeValues: number[] = [];
  const awayValues: number[] = [];
  const vsOpponentValues: number[] = [];

  for (const g of games) {
    const val = (g as any)[col];
    if (val == null) continue;
    allValues.push(val);
    const { opponent, homeAway } = parseMatchup(g.matchup);
    if (homeAway === "home") homeValues.push(val);
    if (homeAway === "away") awayValues.push(val);
    if (todayOpponent && opponent && opponent.trim().toUpperCase() === todayOpponent.trim().toUpperCase()) {
      vsOpponentValues.push(val);
    }
  }

  if (allValues.length < 3) return null;

  const last3 = allValues.slice(0, 3);
  const last5 = allValues.slice(0, 5);
  const last10 = allValues.slice(0, 10);
  const last15 = allValues.slice(0, 15);

  const last3Avg = calcAvg(last3);
  const last5Avg = calcAvg(last5);
  const last10Avg = calcAvg(last10);
  const last15Avg = calcAvg(last15);
  const seasonAvg = calcAvg(allValues);

  // Line-specific hit rates
  const last5HitRate = calcHitRate(last5, threshold);
  const last10HitRate = calcHitRate(last10, threshold);
  const last15HitRate = calcHitRate(last15, threshold);
  const seasonHitRate = calcHitRate(allValues, threshold);

  const vsOpponentAvg = calcAvg(vsOpponentValues);
  const vsOpponentHitRate = calcHitRate(vsOpponentValues, threshold);

  const homeAvg = calcAvg(homeValues);
  const awayAvg = calcAvg(awayValues);
  const homeHitRate = calcHitRate(homeValues, threshold);
  const awayHitRate = calcHitRate(awayValues, threshold);

  // Volatility & consistency
  const stdDev = calcStdDev(allValues);
  const mean = seasonAvg || 0;
  const cv = mean > 0 ? (stdDev / mean) * 100 : 50;
  const volatilityScore = Math.min(100, Math.round(cv * 2));
  const consistencyScore = Math.max(0, 100 - volatilityScore);

  // ===== REFINED SCORING ENGINE =====
  const sampleFactor = Math.min(1, allValues.length / 20);

  // Weight allocation (must sum to 1.0)
  const W_RECENT = 0.25;      // L5 hit rate
  const W_SEASON = 0.15;      // Season hit rate
  const W_TREND = 0.15;       // L3 vs L10 trend
  const W_OPP = 0.12;         // Opponent matchup
  const W_VENUE = 0.10;       // Home/away
  const W_REST = 0.08;        // Rest/fatigue
  const W_DEF = 0.10;         // Defensive matchup
  const W_CONSISTENCY = 0.05; // Consistency bonus

  const recentHR = last5HitRate ?? 0;
  const seasonHR = seasonHitRate ?? 0;
  const trendHR = last3Avg && last10Avg ? (last3Avg > last10Avg ? 0.7 : last3Avg > last10Avg * 0.95 ? 0.5 : 0.3) : 0.5;

  // Opponent split (sample-weighted)
  let oppFactor = 0.5;
  if (vsOpponentValues.length >= 3 && vsOpponentHitRate !== null) {
    oppFactor = vsOpponentHitRate;
  } else if (vsOpponentValues.length >= 1 && vsOpponentHitRate !== null) {
    // Blend with season when sample is tiny
    oppFactor = vsOpponentHitRate * 0.3 + seasonHR * 0.7;
  }

  // Venue split (sample-weighted)
  let venueFactor = 0.5;
  const venueHR = todayHomeAway === "home" ? homeHitRate : awayHitRate;
  const venueGames = todayHomeAway === "home" ? homeValues.length : awayValues.length;
  if (venueGames >= 5 && venueHR !== null) {
    venueFactor = venueHR;
  } else if (venueGames >= 2 && venueHR !== null) {
    venueFactor = venueHR * 0.4 + seasonHR * 0.6;
  }

  // Rest/fatigue factor
  let restFactor = 0.5;
  if (restHitCtx.sample >= 3 && restHitCtx.rate !== null) {
    restFactor = restHitCtx.rate;
  } else if (restCtx.back_to_back) {
    restFactor = 0.4; // slight penalty for B2B
  } else if (restCtx.rest_days != null && restCtx.rest_days >= 3) {
    restFactor = 0.55; // slight boost for well-rested
  }

  // Defensive matchup factor
  let defFactor = 0.5;
  if (defCtx.avg_allowed !== null && defCtx.games >= 10 && mean > 0) {
    // If opponent allows more than average for this stat, it's favorable
    defFactor = Math.min(1, Math.max(0, 0.5 + (defCtx.avg_allowed - threshold) / (threshold * 2)));
  } else if (defCtx.avg_allowed !== null && defCtx.games >= 5) {
    const raw = 0.5 + (defCtx.avg_allowed - threshold) / (threshold * 2);
    defFactor = raw * 0.6 + 0.5 * 0.4; // blend toward neutral for smaller sample
  }

  const consistencyFactor = consistencyScore / 100;

  let rawConfidence = (
    recentHR * W_RECENT +
    seasonHR * W_SEASON +
    trendHR * W_TREND +
    oppFactor * W_OPP +
    venueFactor * W_VENUE +
    restFactor * W_REST +
    defFactor * W_DEF +
    consistencyFactor * W_CONSISTENCY
  ) * 100;

  rawConfidence *= sampleFactor;
  const confidenceScore = Math.round(Math.min(100, Math.max(0, rawConfidence)));

  // Value score
  const avgOverThreshold = mean > 0 ? ((mean - threshold) / threshold) * 100 : 0;
  const valueScore = Math.round(Math.min(100, Math.max(0, 50 + avgOverThreshold * 2)));

  // ===== RICH REASON TAGS =====
  const reasonTags: string[] = [];

  // Line-specific hit rate tags
  if (last10HitRate !== null && last10.length >= 8) {
    const hits = Math.round(last10HitRate * last10.length);
    reasonTags.push(`Hit ${threshold}+ in ${hits}/${last10.length} last games`);
  }

  if (last5HitRate !== null && last5HitRate >= 0.8) reasonTags.push("hot_streak");
  if (last5HitRate !== null && last5HitRate <= 0.2) reasonTags.push("cold_streak");
  if (last3Avg && last10Avg && last3Avg > last10Avg * 1.1) reasonTags.push("trending_up");
  if (last3Avg && last10Avg && last3Avg < last10Avg * 0.9) reasonTags.push("trending_down");
  if (consistencyScore >= 70) reasonTags.push("consistent");
  if (volatilityScore >= 70) reasonTags.push("volatile_recent_form");

  // Opponent tags with sample size
  if (vsOpponentValues.length >= 3 && vsOpponentHitRate !== null && vsOpponentHitRate >= 0.7) {
    reasonTags.push(`Strong vs ${todayOpponent} (${vsOpponentValues.length}g)`);
  }
  if (vsOpponentValues.length >= 3 && vsOpponentHitRate !== null && vsOpponentHitRate <= 0.3) {
    reasonTags.push(`Weak vs ${todayOpponent} (${vsOpponentValues.length}g)`);
  }
  if (vsOpponentValues.length > 0 && vsOpponentValues.length < 3) {
    reasonTags.push(`Weak sample vs ${todayOpponent} (${vsOpponentValues.length}g)`);
  }

  // Home/away tags with sample
  if (todayHomeAway === "home" && homeHitRate !== null && homeValues.length >= 5 && homeHitRate >= 0.7) {
    reasonTags.push(`Strong home split (${Math.round(homeHitRate * 100)}% in ${homeValues.length}g)`);
  }
  if (todayHomeAway === "away" && awayHitRate !== null && awayValues.length >= 5 && awayHitRate >= 0.7) {
    reasonTags.push(`Strong away split (${Math.round(awayHitRate * 100)}% in ${awayValues.length}g)`);
  }

  // Rest tags
  if (restCtx.back_to_back) reasonTags.push("back_to_back");
  if (restCtx.rest_days != null && restCtx.rest_days >= 3) {
    reasonTags.push(`${restCtx.rest_days} days rest`);
  }
  if (restHitCtx.sample >= 3 && restHitCtx.rate !== null) {
    const bucket = restCtx.rest_days != null && restCtx.rest_days <= 1 ? "B2B" : restCtx.rest_days != null && restCtx.rest_days >= 3 ? "rested" : "normal rest";
    reasonTags.push(`${Math.round(restHitCtx.rate * 100)}% hit on ${bucket} (${restHitCtx.sample}g)`);
  }

  // Defensive context tags
  if (defCtx.avg_allowed !== null && defCtx.games >= 5) {
    if (defCtx.avg_allowed > threshold) {
      reasonTags.push(`OPP allows ${defCtx.avg_allowed} avg (${defCtx.games}g)`);
    } else {
      reasonTags.push(`OPP holds to ${defCtx.avg_allowed} avg (${defCtx.games}g)`);
    }
  }

  if (allValues.length >= 15) reasonTags.push("large_sample");
  if (allValues.length < 8) reasonTags.push("small_sample");

  return {
    player_id: games[0].player_id,
    player_name: games[0].player_name || "",
    team_abbr: games[0].team_abbr,
    opponent_abbr: todayOpponent,
    home_away: todayHomeAway,
    stat_type: statKey,
    threshold,
    last3_avg: last3Avg,
    last5_avg: last5Avg,
    last10_avg: last10Avg,
    last15_avg: last15Avg,
    season_avg: seasonAvg,
    last5_hit_rate: last5HitRate,
    last10_hit_rate: last10HitRate,
    last15_hit_rate: last15HitRate,
    season_hit_rate: seasonHitRate,
    total_games: allValues.length,
    vs_opponent_avg: vsOpponentAvg,
    vs_opponent_hit_rate: vsOpponentHitRate,
    vs_opponent_games: vsOpponentValues.length,
    home_avg: homeAvg,
    away_avg: awayAvg,
    home_hit_rate: homeHitRate,
    away_hit_rate: awayHitRate,
    home_games: homeValues.length,
    away_games: awayValues.length,
    confidence_score: confidenceScore,
    value_score: valueScore,
    volatility_score: volatilityScore,
    consistency_score: consistencyScore,
    reason_tags: reasonTags,
    rest_days: restCtx.rest_days,
    back_to_back: restCtx.back_to_back,
    games_last_7: restCtx.games_last_7,
    games_last_14: restCtx.games_last_14,
    rest_hit_rate: restHitCtx.rate,
    rest_sample: restHitCtx.sample,
    opp_def_rank_note: defCtx.note,
    opp_stat_avg_allowed: defCtx.avg_allowed,
    opp_stat_games: defCtx.games,
    line_hit_rate_l5: last5HitRate,
    line_hit_rate_l10: last10HitRate,
    line_hit_rate_season: seasonHitRate,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const body = await req.json().catch(() => ({}));
    const { game_date, top_n = 40, stat_types, thresholds_override, matchups } = body;

    const today = game_date || new Date().toISOString().split("T")[0];

    // 1. Build team matchups
    const teamMatchups: Record<string, { opponent: string; homeAway: string }> = {};

    if (matchups && Array.isArray(matchups) && matchups.length > 0) {
      for (const m of matchups) {
        if (m.home_team) teamMatchups[m.home_team] = { opponent: m.away_team || "", homeAway: "home" };
        if (m.away_team) teamMatchups[m.away_team] = { opponent: m.home_team || "", homeAway: "away" };
      }
    } else {
      const { data: games } = await supabase.from("games_today").select("*").eq("game_date", today);
      if (games) {
        for (const g of games) {
          if (g.home_team_abbr) teamMatchups[g.home_team_abbr] = { opponent: g.away_team_abbr || "", homeAway: "home" };
          if (g.away_team_abbr) teamMatchups[g.away_team_abbr] = { opponent: g.home_team_abbr || "", homeAway: "away" };
        }
      }
    }

    let teamsPlaying = Object.keys(teamMatchups);
    let scoringAllPlayers = teamsPlaying.length === 0;

    // 2. Get player game logs
    const allLogs: GameLog[] = [];

    if (scoringAllPlayers) {
      const { data: logs } = await supabase
        .from("player_recent_games")
        .select("player_id, player_name, team_abbr, game_date, matchup, pts, reb, ast, fg3m, stl, blk, wl")
        .order("game_date", { ascending: false })
        .limit(1000);
      if (logs) allLogs.push(...(logs as GameLog[]));
    } else {
      for (const team of teamsPlaying) {
        const { data: logs } = await supabase
          .from("player_recent_games")
          .select("player_id, player_name, team_abbr, game_date, matchup, pts, reb, ast, fg3m, stl, blk, wl")
          .eq("team_abbr", team)
          .order("game_date", { ascending: false })
          .limit(500);
        if (logs) allLogs.push(...(logs as GameLog[]));
      }
    }

    if (allLogs.length === 0) {
      return new Response(
        JSON.stringify({ scored_props: [], message: "No player game logs found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Group logs by player
    const playerLogs: Record<number, GameLog[]> = {};
    for (const log of allLogs) {
      if (!playerLogs[log.player_id]) playerLogs[log.player_id] = [];
      playerLogs[log.player_id].push(log);
    }

    // 4. Score each player for each stat/threshold combo
    const statsToScore = stat_types || ["pts", "reb", "ast", "fg3m", "stl", "blk"];
    const allScored: ScoredProp[] = [];

    for (const [pidStr, logs] of Object.entries(playerLogs)) {
      const team = logs[0]?.team_abbr;
      if (!team) continue;

      const matchup = teamMatchups[team];
      const opponent = matchup?.opponent || null;
      const homeAway = matchup?.homeAway || "unknown";

      logs.sort((a, b) => b.game_date.localeCompare(a.game_date));

      // Compute rest/fatigue context once per player
      const restCtx = computeRestContext(logs, today);

      for (const stat of statsToScore) {
        const thresholds = thresholds_override?.[stat] || DEFAULT_THRESHOLDS[stat] || [];
        const defCtx = computeDefensiveContext(playerLogs, opponent, stat);

        for (const threshold of thresholds) {
          const restHitCtx = computeRestHitRate(logs, stat, threshold, restCtx.rest_days);
          const scored = scoreProp(logs, stat, threshold, opponent, homeAway, restCtx, restHitCtx, defCtx, playerLogs);
          if (scored) allScored.push(scored);
        }
      }
    }

    // 5. Sort by confidence and return top N
    allScored.sort((a, b) => b.confidence_score - a.confidence_score);
    const topProps = allScored.slice(0, top_n);

    // 6. Cache (fire-and-forget)
    if (topProps.length > 0) {
      const rows = topProps.map((p) => ({
        game_date: today,
        player_id: p.player_id,
        player_name: p.player_name,
        team_abbr: p.team_abbr,
        opponent_abbr: p.opponent_abbr,
        home_away: p.home_away,
        stat_type: p.stat_type,
        threshold: p.threshold,
        last3_avg: p.last3_avg,
        last5_avg: p.last5_avg,
        last10_avg: p.last10_avg,
        last15_avg: p.last15_avg,
        season_avg: p.season_avg,
        last5_hit_rate: p.last5_hit_rate,
        last10_hit_rate: p.last10_hit_rate,
        last15_hit_rate: p.last15_hit_rate,
        season_hit_rate: p.season_hit_rate,
        total_games: p.total_games,
        vs_opponent_avg: p.vs_opponent_avg,
        vs_opponent_hit_rate: p.vs_opponent_hit_rate,
        vs_opponent_games: p.vs_opponent_games,
        home_avg: p.home_avg,
        away_avg: p.away_avg,
        home_hit_rate: p.home_hit_rate,
        away_hit_rate: p.away_hit_rate,
        home_games: p.home_games,
        away_games: p.away_games,
        confidence_score: p.confidence_score,
        value_score: p.value_score,
        volatility_score: p.volatility_score,
        consistency_score: p.consistency_score,
        reason_tags: p.reason_tags,
        scored_at: new Date().toISOString(),
      }));

      supabase
        .from("player_prop_scores")
        .upsert(rows, { onConflict: "game_date,player_id,stat_type,threshold" })
        .then(({ error }) => { if (error) console.error("Cache upsert error:", error); });
    }

    return new Response(
      JSON.stringify({
        scored_props: topProps,
        total_candidates: allScored.length,
        teams_matched: teamsPlaying.length,
        players_analyzed: Object.keys(playerLogs).length,
        scoring_all_players: scoringAllPlayers,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("prop-scoring-engine error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
